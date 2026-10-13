import { blake2AsU8a, encodeAddress } from "@polkadot/util-crypto";
import { u8aConcat, stringToU8a, bnToU8a } from "@polkadot/util";
import type { Chain } from "../chain/client";
import { human, type Asset, type Registry } from "../chain/registry";
import { balancesMulti, balKey, big, unwrapJson } from "./util";

export type StableAssetRow = { asset: Asset; reserve?: bigint; peg: number; priceUsd?: number; valueUsd?: number };
export type Stablepool = {
  id: number; share: Asset; assets: StableAssetRow[]; amplification: number; feeBps: number;
  pegSources: string[]; supply: bigint; tvlUsd?: number; sharePriceUsd?: number; partial: boolean; account: string;
};

export const stablePoolAccount = (poolId: number) => encodeAddress(blake2AsU8a(u8aConcat(stringToU8a("sts"), bnToU8a(poolId, { bitLength: 32, isLe: true })), 256), 0);

export async function loadStablepools(chain: Chain, reg: Registry, prices: Map<number, number>): Promise<Stablepool[]> {
  const [poolsE, pegsE] = await Promise.all([chain.at.query.stableswap.pools.entries(), chain.at.query.stableswap.poolPegs.entries()]);
  const pegs = new Map<number, { current: [unknown, unknown][]; source: unknown[] }>();
  for (const [k, v] of pegsE) pegs.set((k.args[0] as unknown as { toNumber(): number }).toNumber(), unwrapJson(v) as never);
  const pools = poolsE.map(([k, v]) => {
    const id = (k.args[0] as unknown as { toNumber(): number }).toNumber();
    const j = unwrapJson<{ assets: number[]; finalAmplification: number; fee: number }>(v);
    return { id, assetIds: j.assets, amp: j.finalAmplification, fee: j.fee };
  });
  const supplies = await chain.at.query.tokens.totalIssuance.multi(pools.map((p) => p.id));
  const reqs = pools.flatMap((p) => p.assetIds.map((id) => reg.byId.get(id)).filter(Boolean).map((asset) => ({ account: stablePoolAccount(p.id), asset: asset as Asset })));
  const resAll = await balancesMulti(chain, reg, reqs, "stablepool reserves");
  const reserves = pools.map((p) => new Map(p.assetIds.map((id) => [id, resAll.get(balKey(stablePoolAccount(p.id), id))])));

  const out: Stablepool[] = pools.map((p, i) => {
    const share = reg.byId.get(p.id) ?? { id: p.id, symbol: `pool ${p.id}`, name: "", decimals: 18, type: "StableSwap" as const, ed: 0n };
    const peg = pegs.get(p.id);
    const rows: StableAssetRow[] = p.assetIds.map((id, j) => {
      const asset = reg.byId.get(id)!;
      const cur = peg?.current?.[j];
      const pegVal = cur ? Number(big(cur[0])) / Number(big(cur[1])) : 1;
      return { asset, reserve: reserves[i].get(id), peg: pegVal };
    });
    const pegSources = (peg?.source ?? []).map((s) => typeof s === "string" ? s : Object.entries(s as Record<string, unknown>).map(([k, v]) => `${k}${typeof v === "string" ? " " + v.slice(0, 10) + "…" : ""}`).join(""));
    return { id: p.id, share, assets: rows, amplification: p.amp, feeBps: p.fee / 100, pegSources, supply: big(supplies[i].toString()), partial: false, account: stablePoolAccount(p.id) };
  });

  // Aave wraps (underlying ↔ aToken, 1:1) from ICE routing storage — lets aToken prices flow to underlyings and back.
  const wraps: [number, number][] = [];
  try {
    const sr = await chain.at.query.ice.solverRouting.entries();
    for (const [k] of sr) {
      const key = k.args[0].toJSON() as Record<string, unknown>;
      if (Array.isArray(key.aaveWraps)) for (const [u, a] of key.aaveWraps as [number, number][]) wraps.push([u, a]);
      if (Array.isArray(key.aaveWrap)) wraps.push(key.aaveWrap as [number, number]);
    }
  } catch { /* pallet absent on older runtimes */ }

  // Price propagation until stable:
  //  - aToken ⇄ underlying 1:1
  //  - in a pool, a priced asset prices the others through the peg ratio
  //  - a pool whose share is priced externally (e.g. GETH = aToken of share 4200, priced in the Omnipool) prices its assets
  //  - a fully priced pool prices its share (TVL / supply)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const set = (id: number, p: number) => { if (p > 0 && Number.isFinite(p) && !prices.has(id)) { prices.set(id, p); changed = true; } };
    for (const [u, a] of wraps) { if (prices.has(u)) set(a, prices.get(u)!); else if (prices.has(a)) set(u, prices.get(a)!); }
    for (const pool of out) {
      const ref = pool.assets.find((r) => prices.has(r.asset.id));
      const sup = human(pool.supply, pool.share.decimals);
      if (!ref && prices.has(pool.id) && sup > 0) {
        // share priced externally: TVL known; p_i = p_0 × peg_i/peg_0; solve p_0 from TVL = Σ R_i p_i
        const r0 = pool.assets[0];
        const denom = pool.assets.reduce((s, r) => s + (r.reserve != null ? human(r.reserve, r.asset.decimals) * (r.peg / (r0.peg || 1)) : 0), 0);
        if (denom > 0) { const p0 = (prices.get(pool.id)! * sup) / denom; for (const r of pool.assets) set(r.asset.id, p0 * (r.peg / (r0.peg || 1))); }
      }
      const ref2 = pool.assets.find((r) => prices.has(r.asset.id));
      for (const r of pool.assets) {
        const direct = prices.get(r.asset.id);
        if (direct != null) r.priceUsd = direct;
        else if (ref2 && ref2.peg > 0) { r.priceUsd = prices.get(ref2.asset.id)! * (r.peg / ref2.peg); set(r.asset.id, r.priceUsd); }
        r.valueUsd = r.reserve != null && r.priceUsd != null ? human(r.reserve, r.asset.decimals) * r.priceUsd : undefined;
      }
      pool.partial = pool.assets.some((r) => r.valueUsd == null);
      const tvl = pool.assets.reduce((s, r) => s + (r.valueUsd ?? 0), 0);
      pool.tvlUsd = pool.assets.some((r) => r.valueUsd != null) ? tvl : undefined;
      pool.sharePriceUsd = prices.get(pool.id) ?? (pool.tvlUsd != null && sup > 0 && !pool.partial ? pool.tvlUsd / sup : undefined);
      if (pool.sharePriceUsd != null && !pool.partial) set(pool.id, pool.sharePriceUsd);
    }
    if (!changed) break;
  }
  out.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return out;
}
