// Uniswap v3 helpers.
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;

/** token1 per token0 in human units. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  const p = Number(sqrtPriceX96) / Number(Q96);
  return p * p * 10 ** (dec0 - dec1);
}

/** Fees accrued to the currently in-range liquidity between two feeGrowthGlobal snapshots, raw token units. */
export function feesFromGrowth(growthNow: bigint, growthThen: bigint, liquidity: bigint): bigint {
  const d = growthNow >= growthThen ? growthNow - growthThen : growthNow + (2n ** 256n - growthThen);
  return (d * liquidity) / Q128;
}
