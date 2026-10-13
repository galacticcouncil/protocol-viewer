// Node smoke test of the data loaders against an RPC: `npx tsx scripts/smoke.ts ws://127.0.0.1:18001 [account]`
import WebSocket from "ws";
(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket;
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { connect } from "../src/chain/client";
import { loadRegistry } from "../src/chain/registry";
import { loadOmnipool } from "../src/data/omnipool";
import { loadFarms } from "../src/data/farms";
import { loadStablepools } from "../src/data/stableswap";
import { loadClPools } from "../src/data/cl";
import { loadPortfolio } from "../src/data/portfolio";
import { loadBorrow } from "../src/data/borrow";
import { getTimings } from "../src/chain/timing";
import { human } from "../src/chain/registry";

const url = process.argv[2] ?? "wss://rpc.hydradx.cloud";
const account = process.argv[3] ?? "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB";
const only = (process.argv[4] ?? "all").split(",");
const t = (l: string, t0: number) => console.log(`-- ${l}: ${((performance.now() - t0) / 1000).toFixed(2)} s`);

const t0 = performance.now();
const chain = await connect(url, (s) => console.log("  status:", s));
t("connect", t0);
const t1 = performance.now(); const reg = await loadRegistry(chain); t(`registry (${reg.byId.size} assets)`, t1);
const t2 = performance.now(); const omni = await loadOmnipool(chain, reg); t("omnipool", t2);
console.log("  LRNA $", omni.lrnaUsd.toFixed(4));
for (const a of omni.assets) console.log(`  ${a.asset.symbol.padEnd(10)} id ${String(a.asset.id).padEnd(8)} price ${a.priceUsd?.toFixed(4) ?? "—"}  reserve ${human(a.state.reserve, a.asset.decimals).toFixed(2)}  tvl ${a.tvlUsd?.toFixed(0) ?? "—"} H2O ${a.hubReserveHuman?.toFixed(0) ?? "—"} cap ${(a.cap * 100).toFixed(0)}% ${a.reserveError ?? ""}`);
if (only.includes("all") || only.includes("farms")) {
  const t3 = performance.now(); const farms = await loadFarms(chain, reg, omni.prices); t("farms", t3);
  for (const [id, fl] of farms) for (const f of fl) if (f.active) console.log(`  farm asset ${id} gf ${f.globalFarmId}/yf ${f.yieldFarmId} ${f.rewardSymbol} APR ${(f.apr! * 100).toFixed(2)}% pot ${f.potBalance?.toFixed(2)} periodsLeft ${f.periodsLeft?.toFixed(0)} staked $${f.valuedSharesUsd?.toFixed(0)} (${f.priceAdjustmentSource})`);
}
if (only.includes("all") || only.includes("stables")) {
  const t4 = performance.now(); const st = await loadStablepools(chain, reg, omni.prices); t("stablepools", t4);
  for (const p of st) console.log(`  ${p.share.symbol.padEnd(16)} ${p.id}  share $${p.sharePriceUsd?.toFixed(4) ?? "—"}  tvl ${p.tvlUsd?.toFixed(0) ?? "—"} ${p.partial ? "(partial)" : ""}  ${p.assets.map((r) => `${r.asset.symbol}:${r.reserve != null ? human(r.reserve, r.asset.decimals).toFixed(0) : "ERR"}@${r.priceUsd?.toFixed(3) ?? "?"}`).join(" ")}`);
  if (only.includes("all") || only.includes("portfolio")) {
    const t6 = performance.now(); const pf = await loadPortfolio(chain, reg, account, omni, st); t("portfolio", t6);
    console.log(`  assets $${pf.assetsTotalUsd.toFixed(0)}  lps $${pf.lpsTotalUsd.toFixed(0)}  errors ${pf.errors.length}`);
    for (const r of pf.assets.slice(0, 12)) console.log(`   ${r.asset.symbol.padEnd(10)} ${r.amount.toFixed(4)} $${r.valueUsd?.toFixed(0) ?? "—"}`);
    for (const r of pf.lps) console.log(`   LP ${r.kind.padEnd(18)} ${r.label.padEnd(12)} ${r.amount.toFixed(4)} ${r.symbol} ${r.hubAmount ? "+" + r.hubAmount.toFixed(3) + " H2O" : ""} $${r.valueUsd?.toFixed(0) ?? "—"}  ${r.id}`);
    for (const e of pf.errors) console.log("   ERR", e);
  }
}
if (only.includes("all") || only.includes("cl")) {
  const t5 = performance.now(); const cl = await loadClPools(chain, reg, omni.prices); t("cl pools", t5);
  for (const p of cl) console.log(`  ${p.label.padEnd(16)} ${p.sym0}/${p.sym1} fee ${p.feeTier}% price ${p.price1per0?.toFixed(4)} usd ${p.priceUsd0?.toFixed(3)}/${p.priceUsd1?.toFixed(3)} tvl ${p.tvlUsd?.toFixed(0) ?? "—"} feeAPR ${p.feeApr != null ? (p.feeApr * 100).toFixed(2) + "%" : p.feeAprNote} ${p.error ?? ""}`);
}
if (only.includes("all") || only.includes("borrow")) {
  const t7 = performance.now();
  try { const b = await loadBorrow(chain, account); t("borrow", t7);
    console.log(`  HF ${b.healthFactor} collateral $${b.totalCollateralUsd?.toFixed(0)} debt $${b.totalDebtUsd?.toFixed(0)}`);
    for (const m of b.markets.slice(0, 8)) console.log(`   ${m.symbol.padEnd(10)} $${m.priceUsd.toFixed(3)} supply ${(m.supplyApy * 100).toFixed(2)}% borrow ${(m.borrowApy * 100).toFixed(2)}% util ${(m.utilization * 100).toFixed(1)}% liq $${m.totalLiquidityUsd.toFixed(0)} mine ${m.userSuppliedUsd?.toFixed(0) ?? 0}/${m.userBorrowedUsd?.toFixed(0) ?? 0}`);
  } catch (e) { t("borrow FAILED", t7); console.log("  ", (e as Error).message); }
}
const tm = getTimings();
console.log(`== ${tm.length} RPC calls, ${(tm.reduce((s, e) => s + e.ms, 0) / 1000).toFixed(1)} s busy, total wall ${((performance.now() - t0) / 1000).toFixed(1)} s`);
for (const e of [...tm].sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`   ${e.ms.toFixed(0).padStart(6)} ms  ${e.method} ${e.key} ${e.error ?? ""}`);
process.exit(0);
