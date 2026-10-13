// Omnipool math ported from hydration-node math/src/omnipool/math.rs (calculate_remove_liquidity_state_changes),
// without the withdrawal fee (valuation, not execution).
export type AssetState = { hubReserve: bigint; reserve: bigint; shares: bigint };
export type Position = { amount: bigint; shares: bigint; priceN: bigint; priceD: bigint };

const ONE = 10n ** 18n;

/** LRNA per asset unit, raw/raw, as FixedU128-scaled bigint (×1e18). */
export function currentPriceFixed(s: AssetState): bigint {
  if (s.reserve === 0n) return 0n;
  return (s.hubReserve * ONE) / s.reserve;
}

export type LiquidityOut = { assetOut: bigint; hubOut: bigint; sharesRemoved: bigint; protocolSharesKept: bigint };

/** Value of removing `sharesRemoved` shares of `position` from an asset at state `s`. */
export function calculateLiquidityOut(s: AssetState, position: Position, sharesRemoved = position.shares): LiquidityOut {
  if (s.shares === 0n || s.reserve === 0n || position.shares === 0n) return { assetOut: 0n, hubOut: 0n, sharesRemoved: 0n, protocolSharesKept: 0n };
  const currentPrice = currentPriceFixed(s);                         // ×1e18
  const positionPrice = (position.priceN * ONE) / position.priceD;   // ×1e18
  // p_x_r = position_price * current_reserve + 1 (in hub units)
  const pxr = (positionPrice * s.reserve) / ONE + 1n;
  let deltaB = 0n;
  if (currentPrice < positionPrice) {
    const numer = (pxr - s.hubReserve) * sharesRemoved;
    const denom = pxr + s.hubReserve;
    deltaB = numer / denom + 1n;
  }
  const deltaShares = sharesRemoved - deltaB;
  const deltaReserve = (s.reserve * deltaShares) / s.shares;
  let hubOut = 0n;
  if (currentPrice > positionPrice) {
    const sub = s.hubReserve - pxr;
    const sum = s.hubReserve + pxr;
    const div1 = (s.hubReserve * sub) / sum;
    hubOut = (div1 * deltaShares) / s.shares;
  }
  return { assetOut: deltaReserve, hubOut, sharesRemoved: deltaShares, protocolSharesKept: deltaB };
}
