// Omnipool liquidity-mining farms from OmnipoolWarehouseLM storage. APR formula ported from
// sdk-next packages/sdk-next/src/farm/LiquidityMiningApi.ts (farmData), periods = relay-chain blocks.
import { encodeAddress } from "@polkadot/util-crypto";
import { u8aConcat, stringToU8a, bnToU8a } from "@polkadot/util";
import type { Chain } from "../chain/client";
import { human, type Registry } from "../chain/registry";
import { CONFIG } from "../config";
import { balancesMulti, balKey, big, unwrapJson } from "./util";

const ONE = 1e18;
const SECONDS_PER_YEAR = 365 * 24 * 3600;
const OMNIPOOL_SOURCE = "0x6f6d6e69706f6f6c"; // b"omnipool"

export type Farm = {
  assetId: number;
  globalFarmId: number;
  yieldFarmId: number;
  rewardSymbol: string;
  rewardAssetId: number;
  apr: number | undefined;         // fraction per year, before loyalty
  loyaltyInitial?: number;         // initial reward percentage (fraction)
  multiplier: number;
  globalState: string;
  yieldState: string;
  active: boolean;
  potBalance?: number;             // human reward units left in the per-farm account
  potUsd?: number;
  periodsLeft?: number;
  currentPeriod: number;
  plannedEndPeriod: number;        // updated_at-independent: planned_yielding_periods from creation isn't stored; show pot run-out instead
  valuedSharesUsd?: number;        // yield farm total valued shares (in LRNA) in USD
  priceAdjustmentSource: "oracle" | "farm";
};

const potAccount = (globalFarmId: number) =>
  encodeAddress(u8aConcat(stringToU8a("modl"), stringToU8a("OmniWhLM"), bnToU8a(globalFarmId, { bitLength: 32, isLe: true }), new Uint8Array(32 - 4 - 8 - 4)), 0);

export async function loadFarms(chain: Chain, reg: Registry, prices: Map<number, number>): Promise<Map<number, Farm[]>> {
  const [gfE, yfE, ayfE, vd] = await Promise.all([
    chain.at.query.omnipoolWarehouseLM.globalFarm.entries(),
    chain.at.query.omnipoolWarehouseLM.yieldFarm.entries(),
    chain.at.query.omnipoolWarehouseLM.activeYieldFarm.entries(),
    chain.at.query.parachainSystem.validationData(),
  ]);
  const relayBlock = (vd as unknown as { unwrapOr(d: null): { relayParentNumber: { toNumber(): number } } | null }).unwrapOr(null)?.relayParentNumber.toNumber() ?? 0;
  type GF = { id: number; owner: string; totalSharesZ: unknown; rewardCurrency: number; pendingRewards: unknown; accumulatedPaidRewards: unknown; yieldPerPeriod: unknown; plannedYieldingPeriods: number; blocksPerPeriod: number; incentivizedAsset: number; maxRewardPerPeriod: unknown; priceAdjustment: unknown; state: string | Record<string, unknown> };
  const gfs = new Map<number, GF>();
  for (const [k, v] of gfE) gfs.set((k.args[0] as unknown as { toNumber(): number }).toNumber(), unwrapJson<GF>(v));
  const active = new Set<string>();
  for (const [k, v] of ayfE) active.add(`${k.args[0].toString()}:${k.args[1].toString()}:${v.toString()}`);

  // Pot balances per global farm (reward currency), grouped by asset type via balancesOf (one multi + one evm batch).
  const potReqs = [...gfs.values()].flatMap((g) => { const asset = reg.byId.get(g.rewardCurrency); return asset ? [{ account: potAccount(g.id), asset, gid: g.id }] : []; });
  const potBal = await balancesMulti(chain, reg, potReqs, "farm pots");
  const pots = new Map(potReqs.map((r) => [r.gid, potBal.get(balKey(r.account, r.asset.id))]));
  // EMA oracle price reward/incentivized (TenMinutes, omnipool source) — storage; falls back to the farm's price_adjustment.
  const oracleKeys = [...gfs.values()].map((g) => { const a = Math.min(g.rewardCurrency, g.incentivizedAsset), b = Math.max(g.rewardCurrency, g.incentivizedAsset); return [OMNIPOOL_SOURCE, [a, b], "TenMinutes"]; });
  const oracles = await chain.at.query.emaOracle.oracles.multi(oracleKeys as never[]);
  const oraclePrice = new Map<number, number>(); // globalFarmId → price adjustment (reward per incentivized, raw/raw) as FixedU128 number
  [...gfs.values()].forEach((g, i) => {
    const o = oracles[i] as unknown as { isSome: boolean; unwrap(): unknown };
    if (!o?.isSome) return;
    const [entry] = (o.unwrap() as { toJSON(): unknown }).toJSON() as [{ price: { n: unknown; d: unknown } }, number];
    const n = Number(big(entry.price.n)), d = Number(big(entry.price.d));
    if (!n || !d) return;
    // oracle price is (a,b) ordered ascending: price = n/d = b per a? In sdk: if reward < incentivized → n/d else d/n.
    oraclePrice.set(g.id, g.rewardCurrency < g.incentivizedAsset ? n / d : d / n);
  });

  const out = new Map<number, Farm[]>();
  for (const [k, v] of yfE) {
    const assetId = (k.args[0] as unknown as { toNumber(): number }).toNumber();
    const globalFarmId = (k.args[1] as unknown as { toNumber(): number }).toNumber();
    const yieldFarmId = (k.args[2] as unknown as { toNumber(): number }).toNumber();
    const y = unwrapJson<{ multiplier: unknown; loyaltyCurve: { initialRewardPercentage: unknown } | null; totalValuedShares: unknown; state: string | Record<string, unknown> }>(v);
    const g = gfs.get(globalFarmId); if (!g) continue;
    const reward = reg.byId.get(g.rewardCurrency);
    const multiplier = Number(big(y.multiplier)) / ONE;
    const yieldPerPeriod = Number(big(g.yieldPerPeriod));           // Perquintill-ish raw (×1e18)
    const totalSharesZ = Number(big(g.totalSharesZ));
    const maxRewardPerPeriod = Number(big(g.maxRewardPerPeriod));
    const pa = oraclePrice.get(globalFarmId);
    const priceAdjustment = pa ?? Number(big(g.priceAdjustment)) / ONE;
    const periodsPerYear = SECONDS_PER_YEAR / ((CONFIG.relayBlockMs / 1000) * g.blocksPerPeriod);
    let apr: number | undefined;
    if (totalSharesZ <= 0) apr = (multiplier * yieldPerPeriod * periodsPerYear) / ONE;
    else {
      const globalRewardPerPeriod = Math.min(maxRewardPerPeriod, (priceAdjustment * totalSharesZ * yieldPerPeriod) / ONE);
      const poolYieldPerPeriod = (globalRewardPerPeriod * multiplier) / (totalSharesZ * priceAdjustment);
      apr = poolYieldPerPeriod * periodsPerYear;
    }
    const pot = pots.get(globalFarmId);
    const potHuman = pot != null && reward ? human(pot, reward.decimals) : undefined;
    const rewardPrice = reward ? prices.get(reward.id) : undefined;
    const lrnaUsd = prices.get(CONFIG.hubAssetId);
    const currentPeriod = Math.floor(relayBlock / g.blocksPerPeriod);
    const f: Farm = {
      assetId, globalFarmId, yieldFarmId, rewardSymbol: reward?.symbol ?? `#${g.rewardCurrency}`, rewardAssetId: g.rewardCurrency,
      apr, loyaltyInitial: y.loyaltyCurve ? Number(big(y.loyaltyCurve.initialRewardPercentage)) / ONE : undefined, multiplier,
      globalState: typeof g.state === "string" ? g.state : Object.keys(g.state)[0], yieldState: typeof y.state === "string" ? y.state : Object.keys(y.state)[0],
      active: active.has(`${assetId}:${globalFarmId}:${yieldFarmId}`),
      potBalance: potHuman, potUsd: potHuman != null && rewardPrice != null ? potHuman * rewardPrice : undefined,
      periodsLeft: pot != null && maxRewardPerPeriod > 0 ? Number(pot) / maxRewardPerPeriod : undefined,
      currentPeriod, plannedEndPeriod: currentPeriod + (pot != null && maxRewardPerPeriod > 0 ? Number(pot) / maxRewardPerPeriod : 0),
      valuedSharesUsd: lrnaUsd != null ? (Number(big(y.totalValuedShares)) / 1e12) * lrnaUsd : undefined,
      priceAdjustmentSource: pa != null ? "oracle" : "farm",
    };
    if (!out.has(assetId)) out.set(assetId, []);
    out.get(assetId)!.push(f);
  }
  for (const list of out.values()) list.sort((a, b) => Number(b.active) - Number(a.active) || (b.apr ?? 0) - (a.apr ?? 0));
  return out;
}
