import { formatReserves, formatUserSummary } from "@aave/math-utils";
import type { Chain } from "../chain/client";
import { CONFIG } from "../config";
import { uiPoolDataProviderAbi } from "../abi/uiPoolDataProvider";
import { dec, enc } from "./util";
import { h160Of } from "../chain/registry";

export type MarketRow = {
  symbol: string; name: string; underlying: string; priceUsd: number;
  supplyApy: number; borrowApy: number; utilization: number; totalLiquidityUsd: number; totalDebtUsd: number;
  supplyCap: number; borrowCap: number; ltv: number; lt: number; frozen: boolean; paused: boolean; borrowingEnabled: boolean;
  userSupplied?: number; userSuppliedUsd?: number; userBorrowed?: number; userBorrowedUsd?: number; collateral?: boolean;
};
export type BorrowData = { markets: MarketRow[]; healthFactor?: string; netWorthUsd?: number; totalCollateralUsd?: number; totalDebtUsd?: number; ltv?: string; userEmode?: number; timestamp: number };

const NUMERIC = new Set(["decimals", "debtCeilingDecimals", "lastUpdateTimestamp", "stableDebtLastUpdateTimestamp", "eModeCategoryId", "eModeLtv", "eModeLiquidationThreshold", "eModeLiquidationBonus"]);
const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));

export async function loadBorrow(chain: Chain, account?: string): Promise<BorrowData> {
  const { poolAddressesProvider: pap, uiPoolDataProvider: ui } = CONFIG.moneyMarket;
  const calls = [{ to: ui, data: enc(uiPoolDataProviderAbi as never, "getReservesData", [pap]), label: "getReservesData" }];
  const user = account ? h160Of(account) : undefined;
  if (user) calls.push({ to: ui, data: enc(uiPoolDataProviderAbi as never, "getUserReservesData", [pap, user]), label: "getUserReservesData" });
  const [rRes, uRes] = await chain.evm.batch(calls, "money market");
  if (rRes instanceof Error) throw new Error(`getReservesData: ${rRes.message}`);
  const [reservesRaw, base] = dec<readonly [readonly Record<string, unknown>[], Record<string, unknown>]>(uiPoolDataProviderAbi as never, "getReservesData", rRes);
  const ts = await chain.at.query.timestamp.now();
  const currentTimestamp = Math.floor(Number(ts.toString()) / 1000);
  const marketReferenceCurrencyDecimals = Math.round(Math.log10(Number(base.marketReferenceCurrencyUnit)));
  const marketReferencePriceInUsd = str(base.marketReferenceCurrencyPriceInUsd);
  const reserves = reservesRaw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = NUMERIC.has(k) ? Number(v) : typeof v === "bigint" ? v.toString() : v;
    o.id = `${(r.underlyingAsset as string).toLowerCase()}`;
    return o;
  });
  const formatted = formatReserves({ reserves: reserves as never, currentTimestamp, marketReferenceCurrencyDecimals, marketReferencePriceInUsd });
  const markets: MarketRow[] = formatted.map((f) => ({
    symbol: f.symbol, name: f.name, underlying: f.underlyingAsset, priceUsd: Number(f.priceInUSD),
    supplyApy: Number(f.supplyAPY), borrowApy: Number(f.variableBorrowAPY), utilization: Number(f.borrowUsageRatio),
    totalLiquidityUsd: Number(f.totalLiquidityUSD), totalDebtUsd: Number(f.totalDebtUSD),
    supplyCap: Number(f.supplyCap), borrowCap: Number(f.borrowCap), ltv: Number(f.formattedBaseLTVasCollateral), lt: Number(f.formattedReserveLiquidationThreshold),
    frozen: !!(f as unknown as Record<string, unknown>).isFrozen, paused: !!(f as unknown as Record<string, unknown>).isPaused, borrowingEnabled: !!(f as unknown as Record<string, unknown>).borrowingEnabled,
  }));
  const out: BorrowData = { markets, timestamp: currentTimestamp };
  if (user && uRes && !(uRes instanceof Error)) {
    const [userRaw, emode] = dec<readonly [readonly Record<string, unknown>[], number]>(uiPoolDataProviderAbi as never, "getUserReservesData", uRes);
    const userReserves = userRaw.map((r) => ({
      underlyingAsset: (r.underlyingAsset as string).toLowerCase(), scaledATokenBalance: str(r.scaledATokenBalance), usageAsCollateralEnabledOnUser: r.usageAsCollateralEnabledOnUser as boolean,
      stableBorrowRate: str(r.stableBorrowRate), scaledVariableDebt: str(r.scaledVariableDebt), principalStableDebt: str(r.principalStableDebt), stableBorrowLastUpdateTimestamp: Number(r.stableBorrowLastUpdateTimestamp),
    }));
    const summary = formatUserSummary({ currentTimestamp, marketReferencePriceInUsd, marketReferenceCurrencyDecimals, userReserves, formattedReserves: formatted, userEmodeCategoryId: Number(emode) });
    out.healthFactor = summary.healthFactor; out.netWorthUsd = Number(summary.netWorthUSD); out.totalCollateralUsd = Number(summary.totalCollateralUSD); out.totalDebtUsd = Number(summary.totalBorrowsUSD); out.ltv = summary.currentLoanToValue; out.userEmode = Number(emode);
    for (const ur of summary.userReservesData) {
      const m = markets.find((x) => x.underlying.toLowerCase() === ur.underlyingAsset.toLowerCase()); if (!m) continue;
      m.userSupplied = Number(ur.underlyingBalance); m.userSuppliedUsd = Number(ur.underlyingBalanceUSD);
      m.userBorrowed = Number(ur.totalBorrows); m.userBorrowedUsd = Number(ur.totalBorrowsUSD); m.collateral = ur.usageAsCollateralEnabledOnUser;
    }
  } else if (user && uRes instanceof Error) {
    throw new Error(`getUserReservesData: ${uRes.message}`);
  }
  markets.sort((a, b) => b.totalLiquidityUsd - a.totalLiquidityUsd);
  return out;
}
