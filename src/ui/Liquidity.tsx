import { useEffect, useMemo, useState } from "react";
import type { Chain } from "../chain/client";
import { human, type Registry } from "../chain/registry";
import { loadOmnipool, type OmnipoolData } from "../data/omnipool";
import { loadFarms, type Farm } from "../data/farms";
import { loadStablepools, type Stablepool } from "../data/stableswap";
import { loadClPools, type ClPool } from "../data/cl";
import { fmtNum, fmtPct, fmtUsd } from "../data/util";
import { CONFIG } from "../config";

type Phase<T> = { data?: T; error?: string; ms?: number };

export function Liquidity({ chain, reg }: { chain: Chain; reg: Registry }) {
  const [omni, setOmni] = useState<Phase<OmnipoolData>>({});
  const [farms, setFarms] = useState<Phase<Map<number, Farm[]>>>({});
  const [stables, setStables] = useState<Phase<Stablepool[]>>({});
  const [cl, setCl] = useState<Phase<ClPool[]>>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    const run = async <T,>(set: (p: Phase<T>) => void, fn: () => Promise<T>) => {
      const t0 = performance.now();
      try { const data = await fn(); if (alive) set({ data, ms: performance.now() - t0 }); }
      catch (e) { if (alive) set({ error: String((e as Error).message ?? e), ms: performance.now() - t0 }); }
    };
    (async () => {
      const t0 = performance.now();
      let o: OmnipoolData | undefined;
      try { o = await loadOmnipool(chain, reg); if (alive) setOmni({ data: o, ms: performance.now() - t0 }); }
      catch (e) { if (alive) setOmni({ error: String((e as Error).message ?? e) }); return; }
      // Everything else needs the price map; run in parallel.
      void run(setFarms, () => loadFarms(chain, reg, o!.prices));
      void run(setStables, () => loadStablepools(chain, reg, o!.prices));
      void run(setCl, () => loadClPools(chain, reg, o!.prices));
    })();
    return () => { alive = false; };
  }, [chain, reg]);

  const q = search.trim().toLowerCase();
  const match = (s: string, id?: number) => !q || s.toLowerCase().includes(q) || String(id ?? "").includes(q);
  const omniRows = useMemo(() => (omni.data?.assets ?? []).filter((a) => match(a.asset.symbol, a.asset.id)), [omni.data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const omniTvl = (omni.data?.assets ?? []).reduce((s, a) => s + (a.tvlUsd ?? 0), 0);
  const stableTvl = (stables.data ?? []).reduce((s, p) => s + (p.tvlUsd ?? 0), 0);
  const clTvl = (cl.data ?? []).reduce((s, p) => s + (p.tvlUsd ?? 0), 0);
  const bestApr = (id: number) => { const f = (farms.data?.get(id) ?? []).filter((x) => x.active && x.apr != null); return f.length ? Math.max(...f.map((x) => x.apr!)) : undefined; };

  return (
    <div>
      <div className="tiles">
        <Tile label="Omnipool TVL" value={omni.data ? fmtUsd(omniTvl) : omni.error ? "error" : "…"} sub={omni.data ? `H2O $${omni.data.lrnaUsd.toFixed(4)} · ${(omni.ms! / 1000).toFixed(1)} s` : omni.error} />
        <Tile label="Stablepool TVL" value={stables.data ? fmtUsd(stableTvl) : stables.error ? "error" : "…"} sub={stables.data ? `${stables.data.length} pools · ${(stables.ms! / 1000).toFixed(1)} s` : stables.error} />
        <Tile label="Concentrated liquidity TVL" value={cl.data ? fmtUsd(clTvl) : cl.error ? "error" : "…"} sub={cl.data ? `${cl.data.length} pools · ${(cl.ms! / 1000).toFixed(1)} s` : cl.error} />
        <Tile label="Farms" value={farms.data ? String([...farms.data.values()].flat().filter((f) => f.active).length) : farms.error ? "error" : "…"} sub={farms.data ? `active yield farms · ${(farms.ms! / 1000).toFixed(1)} s` : farms.error} />
      </div>
      <input className="search" placeholder="filter by symbol or id" value={search} onChange={(e) => setSearch(e.target.value)} />

      <h3>Omnipool {omni.error && <span className="err">{omni.error}</span>}</h3>
      <table className="grid">
        <thead><tr><th>Asset</th><th>id</th><th className="num">Price</th><th className="num">Reserve</th><th className="num">TVL</th><th className="num">H2O reserve</th><th className="num">Cap</th><th>Tradable</th><th className="num">Best farm APR</th></tr></thead>
        <tbody>
          {omniRows.map((a) => {
            const fl = farms.data?.get(a.asset.id) ?? [];
            const isOpen = expanded.has(a.asset.id);
            return [
              <tr key={a.asset.id} className={fl.length ? "clickable" : ""} onClick={() => { if (!fl.length) return; setExpanded((s) => { const n = new Set(s); if (n.has(a.asset.id)) n.delete(a.asset.id); else n.add(a.asset.id); return n; }); }}>
                <td><b>{a.asset.symbol}</b> <span className="muted">{a.asset.type}</span></td>
                <td className="muted">{a.asset.id}</td>
                <td className="num">{a.reserveError ? <span className="err">{a.reserveError}</span> : fmtUsd(a.priceUsd)}</td>
                <td className="num">{a.reserveError ? "—" : fmtNum(human(a.state.reserve, a.asset.decimals), 2)}</td>
                <td className="num">{fmtUsd(a.tvlUsd)}</td>
                <td className="num">{fmtNum(a.hubReserveHuman, 0)}</td>
                <td className="num">{(a.cap * 100).toFixed(0)}%</td>
                <td className="muted">{tradable(a.tradable)}</td>
                <td className="num">{farms.data ? (fl.length ? `${fmtPct(bestApr(a.asset.id))} (${fl.filter((f) => f.active).length}/${fl.length})` : "—") : farms.error ? <span className="err">farms failed</span> : "…"}</td>
              </tr>,
              isOpen && <tr key={`${a.asset.id}-farms`} className="sub"><td colSpan={9}><FarmTable farms={fl} /></td></tr>,
            ];
          })}
        </tbody>
      </table>

      <h3>Stablepools {stables.error && <span className="err">{stables.error}</span>}</h3>
      <table className="grid">
        <thead><tr><th>Pool</th><th>id</th><th>Assets</th><th className="num">Share price</th><th className="num">TVL</th><th className="num">Fee</th><th className="num">Amp</th><th>Pegs</th><th className="num">Farm APR (share in Omnipool)</th></tr></thead>
        <tbody>
          {(stables.data ?? []).filter((p) => match(p.share.symbol + " " + p.assets.map((r) => r.asset.symbol).join(" "), p.id)).map((p) => (
            <tr key={p.id}>
              <td><b>{p.share.symbol}</b></td><td className="muted">{p.id}</td>
              <td>{p.assets.map((r) => <div key={r.asset.id}>{r.asset.symbol}: {r.reserve == null ? <span className="err">read failed</span> : fmtNum(human(r.reserve, r.asset.decimals), 2)} <span className="muted">{r.priceUsd != null ? `@ ${fmtUsd(r.priceUsd)}` : "unpriced"}{r.peg !== 1 ? ` · peg ${r.peg.toFixed(4)}` : ""}</span></div>)}</td>
              <td className="num">{fmtUsd(p.sharePriceUsd)}</td>
              <td className="num">{fmtUsd(p.tvlUsd)}{p.partial && <span className="warn"> partial</span>}</td>
              <td className="num">{p.feeBps.toFixed(2)} bps</td><td className="num">{p.amplification}</td>
              <td className="muted small">{p.pegSources.join(" / ")}</td>
              <td className="num">{farms.data ? fmtPct(bestApr(p.id)) : "…"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Concentrated liquidity {cl.error && <span className="err">{cl.error}</span>}</h3>
      <table className="grid">
        <thead><tr><th>Pool</th><th>Pair</th><th className="num">Fee tier</th><th className="num">Price (1 per 0)</th><th className="num">Price 0 / 1 (USD)</th><th className="num">Balances</th><th className="num">TVL</th><th className="num">Fee APR</th></tr></thead>
        <tbody>
          {(cl.data ?? []).filter((p) => match(p.label + p.sym0 + p.sym1)).map((p) => (
            <tr key={p.pool}>
              <td><b>{p.label}</b><div className="muted small">{p.pool}</div></td>
              <td>{p.error ? <span className="err">{p.error}</span> : `${p.sym0} / ${p.sym1}`}</td>
              <td className="num">{p.feeTier != null ? `${p.feeTier.toFixed(2)}%` : "—"}</td>
              <td className="num">{p.price1per0 != null ? p.price1per0.toPrecision(6) : "—"}</td>
              <td className="num">{fmtUsd(p.priceUsd0)} / {fmtUsd(p.priceUsd1)}</td>
              <td className="num">{p.bal0 != null ? fmtNum(human(p.bal0, p.dec0), 2) : "—"} {p.sym0}<br />{p.bal1 != null ? fmtNum(human(p.bal1, p.dec1), 2) : "—"} {p.sym1}</td>
              <td className="num">{fmtUsd(p.tvlUsd)}</td>
              <td className="num">{p.feeApr != null ? fmtPct(p.feeApr) : <span className="muted">{p.feeAprNote ?? "…"}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Prices anchor HOLLAR ({CONFIG.anchorAssetId}) at $1.00 via the Omnipool. Block {chain.blockNumber.toLocaleString()} · {chain.blockHash.slice(0, 10)}…</p>
    </div>
  );
}

function FarmTable({ farms }: { farms: Farm[] }) {
  return (
    <table className="inner">
      <thead><tr><th>Global farm</th><th>Yield farm</th><th>Reward</th><th className="num">APR</th><th className="num">Loyalty start</th><th className="num">Multiplier</th><th>State</th><th className="num">Pot left</th><th className="num">Periods left</th><th className="num">Staked (USD)</th><th>Price adj.</th></tr></thead>
      <tbody>
        {farms.map((f) => (
          <tr key={`${f.globalFarmId}-${f.yieldFarmId}`} className={f.active ? "" : "muted"}>
            <td>{f.globalFarmId}</td><td>{f.yieldFarmId}</td><td>{f.rewardSymbol}</td>
            <td className="num"><b>{fmtPct(f.apr)}</b></td>
            <td className="num">{f.loyaltyInitial != null ? fmtPct(f.loyaltyInitial) : "—"}</td>
            <td className="num">{f.multiplier}</td>
            <td>{f.globalState} / {f.yieldState}{!f.active && " (inactive)"}{f.active && f.potBalance != null && f.potBalance <= 0 && <span className="warn"> pot empty</span>}</td>
            <td className="num">{f.potBalance != null ? `${fmtNum(f.potBalance, 2)} ${f.rewardSymbol}` : "—"}<div className="muted small">{fmtUsd(f.potUsd)}</div></td>
            <td className="num">{f.periodsLeft != null ? `${fmtNum(f.periodsLeft, 0)} (~${(f.periodsLeft * CONFIG.relayBlockMs / 86_400_000).toFixed(1)} d)` : "—"}</td>
            <td className="num">{fmtUsd(f.valuedSharesUsd)}</td>
            <td className="muted small">{f.priceAdjustmentSource}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div><div className="muted small">{sub}</div></div>;
}

function tradable(bits: number) {
  if (bits === 15) return "all";
  if (bits === 0) return "frozen";
  const f: string[] = []; if (bits & 1) f.push("sell"); if (bits & 2) f.push("buy"); if (bits & 4) f.push("add"); if (bits & 8) f.push("remove");
  return f.join(",");
}
