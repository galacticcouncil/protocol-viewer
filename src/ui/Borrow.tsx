import { useEffect, useState } from "react";
import type { Chain } from "../chain/client";
import { CONFIG } from "../config";
import { loadBorrow, type BorrowData } from "../data/borrow";
import { fmtNum, fmtPct, fmtUsd } from "../data/util";

export function Borrow({ chain }: { chain: Chain }) {
  const [address, setAddress] = useState<string>(() => { try { return localStorage.getItem("pv:account") || CONFIG.accounts[0].address; } catch { return CONFIG.accounts[0].address; } });
  const [target, setTarget] = useState(address);
  const [data, setData] = useState<BorrowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true; setData(null); setError(null); setMs(null);
    const t0 = performance.now();
    loadBorrow(chain, target || undefined).then((d) => { if (alive) { setData(d); setMs(performance.now() - t0); } }, (e) => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
  }, [chain, target]);

  return (
    <div>
      <form className="rpc" onSubmit={(e) => { e.preventDefault(); setTarget(address.trim()); }}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} placeholder="account (SS58 or 0x) — optional" className="wide" />
        <button type="submit">Load</button>
        <span className="muted">{ms != null ? `loaded in ${(ms / 1000).toFixed(1)} s` : error ? "" : "loading… (first money-market read on a cold fork can take a minute)"}</span>
      </form>
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          {data.healthFactor != null && (
            <div className="tiles">
              <Tile label="Health factor" value={Number(data.healthFactor) > 1e6 ? "∞" : Number(data.healthFactor).toFixed(3)} />
              <Tile label="Collateral" value={fmtUsd(data.totalCollateralUsd)} />
              <Tile label="Debt" value={fmtUsd(data.totalDebtUsd)} />
              <Tile label="Net worth" value={fmtUsd(data.netWorthUsd)} sub={`LTV ${fmtPct(Number(data.ltv))} · e-mode ${data.userEmode}`} />
            </div>
          )}
          <table className="grid">
            <thead><tr><th>Market</th><th className="num">Price</th><th className="num">Supply APY</th><th className="num">Borrow APY</th><th className="num">Utilisation</th><th className="num">Supplied (USD)</th><th className="num">Borrowed (USD)</th><th className="num">Caps S / B</th><th className="num">LTV / LT</th><th>Flags</th><th className="num">My supply</th><th className="num">My debt</th></tr></thead>
            <tbody>{data.markets.map((m) => (
              <tr key={m.underlying}>
                <td><b>{m.symbol}</b><div className="muted small">{m.name}</div></td>
                <td className="num">{fmtUsd(m.priceUsd)}</td>
                <td className="num">{fmtPct(m.supplyApy)}</td>
                <td className="num">{m.borrowingEnabled ? fmtPct(m.borrowApy) : "—"}</td>
                <td className="num">{fmtPct(m.utilization)}</td>
                <td className="num">{fmtUsd(m.totalLiquidityUsd)}</td>
                <td className="num">{fmtUsd(m.totalDebtUsd)}</td>
                <td className="num">{fmtNum(m.supplyCap, 0)} / {fmtNum(m.borrowCap, 0)}</td>
                <td className="num">{fmtPct(m.ltv)} / {fmtPct(m.lt)}</td>
                <td className="muted small">{[m.frozen && "frozen", m.paused && "paused", !m.borrowingEnabled && "no borrow"].filter(Boolean).join(", ")}</td>
                <td className="num">{m.userSupplied ? <>{fmtNum(m.userSupplied, 4)}<div className="muted small">{fmtUsd(m.userSuppliedUsd)}{m.collateral ? " · collateral" : ""}</div></> : "—"}</td>
                <td className="num">{m.userBorrowed ? <>{fmtNum(m.userBorrowed, 4)}<div className="muted small">{fmtUsd(m.userBorrowedUsd)}</div></> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="muted small">UiPoolDataProviderV3 {CONFIG.moneyMarket.uiPoolDataProvider} · provider {CONFIG.moneyMarket.poolAddressesProvider} · timestamp {new Date(data.timestamp * 1000).toISOString()}</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div><div className="muted small">{sub}</div></div>;
}
