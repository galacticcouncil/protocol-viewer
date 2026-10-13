import { useEffect, useState } from "react";
import type { Chain } from "../chain/client";
import type { Registry } from "../chain/registry";
import { CONFIG } from "../config";
import { loadOmnipool } from "../data/omnipool";
import { loadStablepools } from "../data/stableswap";
import { loadPortfolio, type Portfolio as PortfolioData } from "../data/portfolio";
import { fmtNum, fmtUsd } from "../data/util";

const LS_ACCT = "pv:account", LS_ACCTS = "pv:accounts";
type Saved = { label: string; address: string };
const savedAccounts = (): Saved[] => { try { const s = localStorage.getItem(LS_ACCTS); if (s) return JSON.parse(s); } catch { /* ignore */ } return [...CONFIG.accounts]; };

export function Portfolio({ chain, reg }: { chain: Chain; reg: Registry }) {
  const [accounts, setAccounts] = useState<Saved[]>(savedAccounts);
  const [address, setAddress] = useState<string>(() => { try { return localStorage.getItem(LS_ACCT) || CONFIG.accounts[0].address; } catch { return CONFIG.accounts[0].address; } });
  const [target, setTarget] = useState(address);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true; setData(null); setError(null);
    (async () => {
      const t0 = performance.now();
      try {
        setStatus("omnipool + stablepools (prices)…");
        const omni = await loadOmnipool(chain, reg);
        const stables = await loadStablepools(chain, reg, omni.prices);
        setStatus("account balances and positions…");
        const p = await loadPortfolio(chain, reg, target, omni, stables);
        if (!alive) return;
        setData(p); setStatus(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
        try { localStorage.setItem(LS_ACCT, target); } catch { /* ignore */ }
      } catch (e) { if (alive) { setError(String((e as Error).message ?? e)); setStatus(""); } }
    })();
    return () => { alive = false; };
  }, [chain, reg, target]);

  const save = () => { const label = prompt("Label for this account?") || target.slice(0, 8); const list = [...accounts.filter((a) => a.address !== target), { label, address: target }]; setAccounts(list); try { localStorage.setItem(LS_ACCTS, JSON.stringify(list)); } catch { /* ignore */ } };

  return (
    <div>
      <form className="rpc" onSubmit={(e) => { e.preventDefault(); setTarget(address.trim()); }}>
        <select value={accounts.find((a) => a.address === address)?.address ?? ""} onChange={(e) => { setAddress(e.target.value); setTarget(e.target.value); }}>
          <option value="">— saved accounts —</option>
          {accounts.map((a) => <option key={a.address} value={a.address}>{a.label}</option>)}
        </select>
        <input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} placeholder="SS58 or 0x address" className="wide" />
        <button type="submit">Load</button>
        <button type="button" onClick={save}>Save</button>
        <span className="muted">{status}</span>
      </form>
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <p className="muted small">{data.account} · ERC-20 holder {data.h160}{data.errors.length ? ` · ${data.errors.length} read errors: ${data.errors.join("; ")}` : ""}</p>
          <div className="tiles">
            <Tile label="Assets" value={fmtUsd(data.assetsTotalUsd)} sub={`${data.assets.length} assets (external + XYK excluded)`} />
            <Tile label="LP positions" value={fmtUsd(data.lpsTotalUsd)} sub={`${data.lps.length} positions`} />
          </div>
          <h3>Assets</h3>
          <table className="grid">
            <thead><tr><th>Asset</th><th>id</th><th>Type</th><th className="num">Amount</th><th className="num">Price</th><th className="num">Value</th></tr></thead>
            <tbody>{data.assets.map((r) => (
              <tr key={r.asset.id}><td><b>{r.asset.symbol}</b></td><td className="muted">{r.asset.id}</td><td className="muted">{r.asset.type}</td><td className="num">{fmtNum(r.amount, 4)}</td><td className="num">{fmtUsd(r.priceUsd)}</td><td className="num">{fmtUsd(r.valueUsd)}</td></tr>
            ))}</tbody>
          </table>
          <h3>LP positions</h3>
          <table className="grid">
            <thead><tr><th>Kind</th><th>Pool / asset</th><th>Position</th><th className="num">Amount</th><th className="num">+ H2O</th><th className="num">Price</th><th className="num">Value</th><th>Note</th></tr></thead>
            <tbody>{data.lps.map((r, i) => (
              <tr key={i}><td>{r.kind}</td><td><b>{r.label}</b></td><td className="muted small">{r.id}</td><td className="num">{fmtNum(r.amount, 4)} {r.symbol}</td><td className="num">{r.hubAmount != null ? fmtNum(r.hubAmount, 4) : "—"}</td><td className="num">{fmtUsd(r.priceUsd)}</td><td className="num">{fmtUsd(r.valueUsd)}</td><td className="muted small">{r.note}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div><div className="muted small">{sub}</div></div>;
}
