import type { Chain } from "../chain/client";
import { human, type Asset, type Registry } from "../chain/registry";
import { CONFIG } from "../config";
import { balancesOf, big, unwrapJson } from "./util";
import type { AssetState } from "../math/omnipool";

export type OmniAsset = {
  asset: Asset;
  state: AssetState;             // hubReserve, reserve, shares (raw)
  protocolShares: bigint;
  cap: number;                   // weight cap, fraction
  tradable: number;              // bitflags
  lrnaPerUnit?: number;          // human LRNA per human asset unit
  priceUsd?: number;
  tvlUsd?: number;               // reserve × price
  hubReserveHuman?: number;      // H2O in the pool for this asset
  reserveError?: string;
};
export type OmnipoolData = { assets: OmniAsset[]; prices: Map<number, number>; lrnaUsd: number; hubBalance: bigint };

export async function loadOmnipool(chain: Chain, reg: Registry): Promise<OmnipoolData> {
  const entries = await chain.at.query.omnipool.assets.entries();
  const rows = entries.map(([k, v]) => {
    const id = (k.args[0] as unknown as { toNumber(): number }).toNumber();
    const j = unwrapJson<{ hubReserve: unknown; shares: unknown; protocolShares: unknown; cap: unknown; tradable: { bits: number } }>(v);
    const asset = reg.byId.get(id) ?? { id, symbol: `#${id}`, name: "", decimals: 12, type: "Token" as const, ed: 0n };
    return { id, asset, hubReserve: big(j.hubReserve), shares: big(j.shares), protocolShares: big(j.protocolShares), cap: Number(big(j.cap)) / 1e18, tradable: j.tradable?.bits ?? 0 };
  });
  const lrna = reg.byId.get(CONFIG.hubAssetId)!;
  const [balances, hubBal] = await Promise.all([
    balancesOf(chain, reg, CONFIG.omnipoolAccount, rows.map((r) => r.asset)),
    balancesOf(chain, reg, CONFIG.omnipoolAccount, [lrna]),
  ]);
  const assets: OmniAsset[] = rows.map((r) => {
    const reserve = balances.get(r.id);
    const state: AssetState = { hubReserve: r.hubReserve, reserve: reserve ?? 0n, shares: r.shares };
    const o: OmniAsset = { asset: r.asset, state, protocolShares: r.protocolShares, cap: r.cap, tradable: r.tradable };
    if (reserve == null) o.reserveError = "reserve read failed";
    else if (reserve > 0n) o.lrnaPerUnit = human(r.hubReserve, lrna.decimals) / human(reserve, r.asset.decimals);
    return o;
  });
  // Anchor: HOLLAR = 1 USD → LRNA price = 1 / (LRNA per HOLLAR)
  const anchor = assets.find((a) => a.asset.id === CONFIG.anchorAssetId);
  const lrnaUsd = anchor?.lrnaPerUnit ? 1 / anchor.lrnaPerUnit : NaN;
  const prices = new Map<number, number>();
  prices.set(CONFIG.hubAssetId, lrnaUsd);
  for (const a of assets) {
    if (a.lrnaPerUnit != null && Number.isFinite(lrnaUsd)) {
      a.priceUsd = a.lrnaPerUnit * lrnaUsd;
      a.tvlUsd = human(a.state.reserve, a.asset.decimals) * a.priceUsd;
      a.hubReserveHuman = human(a.state.hubReserve, lrna.decimals);
      prices.set(a.asset.id, a.priceUsd);
    }
  }
  assets.sort((x, y) => (y.tvlUsd ?? 0) - (x.tvlUsd ?? 0));
  return { assets, prices, lrnaUsd, hubBalance: hubBal.get(CONFIG.hubAssetId) ?? 0n };
}
