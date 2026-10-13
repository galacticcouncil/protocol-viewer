import type { Chain } from "../chain/client";
import { human, type Registry } from "../chain/registry";
import { CONFIG } from "../config";
import { v3PoolAbi, erc20Abi } from "../abi/minimal";
import { dec, enc, big } from "./util";
import { priceFromSqrtX96, feesFromGrowth } from "../math/v3";

export type ClPool = {
  label: string; pool: string; vault?: string;
  token0?: string; token1?: string; sym0: string; sym1: string; dec0: number; dec1: number;
  feeTier?: number; price1per0?: number; priceUsd0?: number; priceUsd1?: number;
  bal0?: bigint; bal1?: bigint; tvlUsd?: number; liquidity?: bigint; tick?: number;
  feeApr?: number; feeAprNote?: string; error?: string;
};

export async function loadClPools(chain: Chain, reg: Registry, prices: Map<number, number>): Promise<ClPool[]> {
  const pools = CONFIG.clPools;
  // Batch 1: static + state per pool (6 calls each).
  const calls = pools.flatMap((p) => ["token0", "token1", "fee", "slot0", "liquidity", "feeGrowthGlobal0X128", "feeGrowthGlobal1X128"].map((fn) => ({ to: p.pool, data: enc(v3PoolAbi, fn), label: `${p.label} ${fn}` })));
  const res = await chain.evm.batch(calls, `v3 pools state ×${pools.length}`);
  const out: ClPool[] = pools.map((p, i) => {
    const r = res.slice(i * 7, i * 7 + 7);
    const err = r.find((x) => x instanceof Error) as Error | undefined;
    const row: ClPool = { label: p.label, pool: p.pool, vault: p.vault, sym0: "?", sym1: "?", dec0: 18, dec1: 18 };
    if (err) { row.error = err.message; return row; }
    row.token0 = (dec<string>(v3PoolAbi, "token0", r[0] as string)).toLowerCase();
    row.token1 = (dec<string>(v3PoolAbi, "token1", r[1] as string)).toLowerCase();
    row.feeTier = Number(dec<number>(v3PoolAbi, "fee", r[2] as string)) / 1e4;
    const slot0 = dec<readonly [bigint, number]>(v3PoolAbi, "slot0", r[3] as string);
    row.liquidity = big(dec<bigint>(v3PoolAbi, "liquidity", r[4] as string));
    row.tick = Number(slot0[1]);
    const a0 = reg.byErc20.get(row.token0), a1 = reg.byErc20.get(row.token1);
    row.sym0 = a0?.symbol ?? row.token0.slice(0, 8); row.sym1 = a1?.symbol ?? row.token1.slice(0, 8);
    row.dec0 = a0?.decimals ?? 18; row.dec1 = a1?.decimals ?? 18;
    row.price1per0 = priceFromSqrtX96(big(slot0[0]), row.dec0, row.dec1);
    row.priceUsd0 = a0 ? prices.get(a0.id) : undefined; row.priceUsd1 = a1 ? prices.get(a1.id) : undefined;
    if (row.priceUsd0 == null && row.priceUsd1 != null) row.priceUsd0 = row.priceUsd1 * row.price1per0;
    if (row.priceUsd1 == null && row.priceUsd0 != null) row.priceUsd1 = row.priceUsd0 / row.price1per0;
    (row as unknown as { fg0: bigint; fg1: bigint }).fg0 = big(dec<bigint>(v3PoolAbi, "feeGrowthGlobal0X128", r[5] as string));
    (row as unknown as { fg0: bigint; fg1: bigint }).fg1 = big(dec<bigint>(v3PoolAbi, "feeGrowthGlobal1X128", r[6] as string));
    return row;
  });
  // Batch 2: token balances held by the pool (TVL).
  const ok = out.filter((r) => !r.error);
  const balCalls = ok.flatMap((r) => [
    { to: r.token0!, data: enc(erc20Abi, "balanceOf", [r.pool]), label: `${r.label} bal0` },
    { to: r.token1!, data: enc(erc20Abi, "balanceOf", [r.pool]), label: `${r.label} bal1` },
  ]);
  const bals = await chain.evm.batch(balCalls, `v3 pool balances ×${ok.length}`);
  ok.forEach((r, i) => {
    const b0 = bals[i * 2], b1 = bals[i * 2 + 1];
    if (!(b0 instanceof Error)) r.bal0 = big(dec<bigint>(erc20Abi, "balanceOf", b0));
    if (!(b1 instanceof Error)) r.bal1 = big(dec<bigint>(erc20Abi, "balanceOf", b1));
    if (r.bal0 != null && r.bal1 != null && r.priceUsd0 != null && r.priceUsd1 != null)
      r.tvlUsd = human(r.bal0, r.dec0) * r.priceUsd0 + human(r.bal1, r.dec1) * r.priceUsd1;
  });
  // Batch 3 (best effort): fee growth N blocks ago → fee APR for in-range liquidity.
  const oldBlock = "0x" + Math.max(1, chain.blockNumber - CONFIG.clFeeWindowBlocks).toString(16);
  try {
    const oldCalls = ok.flatMap((r) => ["feeGrowthGlobal0X128", "feeGrowthGlobal1X128"].map((fn) => ({ to: r.pool, data: enc(v3PoolAbi, fn), block: oldBlock, label: `${r.label} ${fn} @-${CONFIG.clFeeWindowBlocks}` })));
    const old = await chain.evm.batch(oldCalls, `v3 fee growth @block-${CONFIG.clFeeWindowBlocks}`);
    ok.forEach((r, i) => {
      const o0 = old[i * 2], o1 = old[i * 2 + 1];
      if (o0 instanceof Error || o1 instanceof Error) { r.feeAprNote = "needs history"; return; }
      const fg = r as unknown as { fg0: bigint; fg1: bigint };
      if (r.liquidity == null || r.tvlUsd == null || r.tvlUsd === 0 || r.priceUsd0 == null || r.priceUsd1 == null) { r.feeAprNote = "unpriced"; return; }
      const f0 = feesFromGrowth(fg.fg0, big(dec<bigint>(v3PoolAbi, "feeGrowthGlobal0X128", o0)), r.liquidity);
      const f1 = feesFromGrowth(fg.fg1, big(dec<bigint>(v3PoolAbi, "feeGrowthGlobal1X128", o1)), r.liquidity);
      const feesUsd = human(f0, r.dec0) * r.priceUsd0 + human(f1, r.dec1) * r.priceUsd1;
      const windowSec = (CONFIG.clFeeWindowBlocks * CONFIG.paraBlockMs) / 1000;
      r.feeApr = (feesUsd / r.tvlUsd) * ((365 * 24 * 3600) / windowSec);
      r.feeAprNote = `fees over last ${CONFIG.clFeeWindowBlocks} blocks, in-range liquidity`;
    });
  } catch (e) { for (const r of ok) r.feeAprNote = `needs history (${(e as Error).message})`; }
  return out;
}
