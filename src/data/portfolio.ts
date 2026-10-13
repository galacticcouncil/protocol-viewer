import type { Chain } from "../chain/client";
import { human, h160Of, type Asset, type Registry } from "../chain/registry";
import { CONFIG } from "../config";
import { balancesOf, big, dec, enc } from "./util";
import { calculateLiquidityOut } from "../math/omnipool";
import type { OmnipoolData } from "./omnipool";
import type { Stablepool } from "./stableswap";
import { gammaVaultAbi } from "../abi/minimal";

export type AssetRow = { asset: Asset; balance: bigint; amount: number; priceUsd?: number; valueUsd?: number };
export type LpRow = {
  kind: "Omnipool" | "Omnipool (farmed)" | "Stablepool" | "CL vault";
  label: string; id: string; amount: number; symbol: string; hubAmount?: number;
  priceUsd?: number; valueUsd?: number; note?: string;
};
export type Portfolio = { account: string; h160: string; assets: AssetRow[]; lps: LpRow[]; assetsTotalUsd: number; lpsTotalUsd: number; errors: string[] };

export async function loadPortfolio(chain: Chain, reg: Registry, account: string, omni: OmnipoolData, stables: Stablepool[]): Promise<Portfolio> {
  const errors: string[] = [];
  const h160 = h160Of(account);
  // --- asset balances: one keys sweep for Tokens.Accounts under the account prefix, HDX, and ERC-20s in one batch
  const [tokenEntries, native] = await Promise.all([
    chain.at.query.tokens.accounts.entries(account),
    chain.at.query.system.account(account),
  ]);
  const held = new Map<number, bigint>();
  for (const [k, v] of tokenEntries) {
    const id = (k.args[1] as unknown as { toNumber(): number }).toNumber();
    const free = big((v as unknown as { free: unknown }).free);
    if (free > 0n) held.set(id, free);
  }
  const hdx = big((native as unknown as { data: { free: unknown } }).data.free);
  if (hdx > 0n) held.set(0, hdx);
  const ercAssets = [...reg.byId.values()].filter((a) => a.type === "Erc20" && a.erc20);
  const erc = await balancesOf(chain, reg, account, ercAssets, `portfolio erc20 ${account.slice(0, 6)}`);
  for (const [id, bal] of erc) { if (bal == null) errors.push(`${reg.byId.get(id)?.symbol}: balance read failed`); else if (bal > 0n) held.set(id, bal); }

  const shareIds = new Set(stables.map((s) => s.id));
  const assets: AssetRow[] = [];
  const lps: LpRow[] = [];
  for (const [id, balance] of held) {
    const asset = reg.byId.get(id); if (!asset) continue;
    if (asset.type === "External" || asset.type === "XYK") continue;
    const amount = human(balance, asset.decimals);
    const priceUsd = omni.prices.get(id);
    if (shareIds.has(id)) {
      const pool = stables.find((s) => s.id === id)!;
      lps.push({ kind: "Stablepool", label: pool.share.symbol, id: String(id), amount, symbol: pool.share.symbol, priceUsd: pool.sharePriceUsd, valueUsd: pool.sharePriceUsd != null ? amount * pool.sharePriceUsd : undefined, note: pool.partial ? "pool partially priced" : undefined });
      continue;
    }
    const clVault = CONFIG.clPools.find((p) => p.shareAssetId === id);
    if (clVault) continue; // valued below from the vault
    assets.push({ asset, balance, amount, priceUsd, valueUsd: priceUsd != null ? amount * priceUsd : undefined });
  }
  assets.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  // --- Omnipool positions (NFT collection 1337) and farmed positions (LM deposits, collection 2584)
  const [posKeys, depKeys] = await Promise.all([
    chain.at.query.uniques.account.keys(account, CONFIG.omnipoolNftCollection),
    chain.at.query.uniques.account.keys(account, CONFIG.lmNftCollection),
  ]);
  const posIds = posKeys.map((k) => (k.args[2] as unknown as { toString(): string }).toString());
  const depIds = depKeys.map((k) => (k.args[2] as unknown as { toString(): string }).toString());
  const depPosIds = depIds.length ? (await chain.at.query.omnipoolLiquidityMining.omniPositionId.multi(depIds)).map((o) => (o as unknown as { toString(): string }).toString()) : [];
  const allPos = [...posIds, ...depPosIds];
  const positions = allPos.length ? await chain.at.query.omnipool.positions.multi(allPos) : [];
  positions.forEach((p, i) => {
    const o = p as unknown as { isSome: boolean; unwrap(): { toJSON(): unknown } };
    if (!o.isSome) return;
    const j = o.unwrap().toJSON() as { assetId: number; amount: unknown; shares: unknown; price: [unknown, unknown] };
    const oa = omni.assets.find((a) => a.asset.id === j.assetId);
    const asset = reg.byId.get(j.assetId);
    const farmed = i >= posIds.length;
    const idLabel = farmed ? `deposit ${depIds[i - posIds.length]} → position ${allPos[i]}` : `position ${allPos[i]}`;
    if (!oa || !asset) { lps.push({ kind: farmed ? "Omnipool (farmed)" : "Omnipool", label: `#${j.assetId}`, id: idLabel, amount: 0, symbol: "?", note: "asset not in Omnipool" }); return; }
    const out = calculateLiquidityOut(oa.state, { amount: big(j.amount), shares: big(j.shares), priceN: big(j.price[0]), priceD: big(j.price[1]) });
    const amount = human(out.assetOut, asset.decimals);
    const hubAmount = human(out.hubOut, 12);
    const price = omni.prices.get(j.assetId);
    const value = price != null ? amount * price + hubAmount * omni.lrnaUsd : undefined;
    lps.push({ kind: farmed ? "Omnipool (farmed)" : "Omnipool", label: asset.symbol, id: idLabel, amount, symbol: asset.symbol, hubAmount: hubAmount > 0 ? hubAmount : undefined, priceUsd: price, valueUsd: value,
      note: `initial ${human(big(j.amount), asset.decimals).toFixed(4)} ${asset.symbol}` });
  });

  // --- Gamma vault shares (one batch: balanceOf, totalSupply, getTotalAmounts per vault)
  const vaults = CONFIG.clPools.filter((p) => p.vault);
  if (vaults.length) {
    const calls = vaults.flatMap((v) => [
      { to: v.vault!, data: enc(gammaVaultAbi, "balanceOf", [h160]), label: `${v.label} vault balanceOf` },
      { to: v.vault!, data: enc(gammaVaultAbi, "totalSupply"), label: `${v.label} vault totalSupply` },
      { to: v.vault!, data: enc(gammaVaultAbi, "getTotalAmounts"), label: `${v.label} vault getTotalAmounts` },
      { to: v.vault!, data: enc(gammaVaultAbi, "token0"), label: `${v.label} vault token0` },
      { to: v.vault!, data: enc(gammaVaultAbi, "token1"), label: `${v.label} vault token1` },
    ]);
    const rs = await chain.evm.batch(calls, `gamma vaults ×${vaults.length}`);
    vaults.forEach((v, i) => {
      const r = rs.slice(i * 5, i * 5 + 5);
      if (r.some((x) => x instanceof Error)) { errors.push(`${v.label} vault: read failed`); return; }
      const bal = big(dec<bigint>(gammaVaultAbi, "balanceOf", r[0] as string));
      if (bal === 0n) return;
      const supply = big(dec<bigint>(gammaVaultAbi, "totalSupply", r[1] as string));
      const [t0, t1] = dec<readonly [bigint, bigint]>(gammaVaultAbi, "getTotalAmounts", r[2] as string);
      const a0 = reg.byErc20.get(dec<string>(gammaVaultAbi, "token0", r[3] as string).toLowerCase());
      const a1 = reg.byErc20.get(dec<string>(gammaVaultAbi, "token1", r[4] as string).toLowerCase());
      const share = Number(bal) / Number(supply || 1n);
      const p0 = a0 ? omni.prices.get(a0.id) : undefined, p1 = a1 ? omni.prices.get(a1.id) : undefined;
      const value = a0 && a1 && p0 != null && p1 != null ? share * (human(big(t0), a0.decimals) * p0 + human(big(t1), a1.decimals) * p1) : undefined;
      lps.push({ kind: "CL vault", label: v.label, id: v.vault!.slice(0, 10) + "…", amount: human(bal, 18), symbol: "shares", valueUsd: value, priceUsd: value != null ? value / human(bal, 18) : undefined, note: `${(share * 100).toFixed(2)}% of vault` });
    });
  }
  const sum = (rows: { valueUsd?: number }[]) => rows.reduce((s, r) => s + (r.valueUsd ?? 0), 0);
  return { account, h160, assets, lps, assetsTotalUsd: sum(assets), lpsTotalUsd: sum(lps), errors };
}
