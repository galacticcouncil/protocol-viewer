import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG } from "./config";
import { connect, disconnect, type Chain } from "./chain/client";
import { loadRegistry, type Registry } from "./chain/registry";
import { clearTimings } from "./chain/timing";
import { TimingDrawer } from "./ui/TimingDrawer";
import { Liquidity } from "./ui/Liquidity";
import { Portfolio } from "./ui/Portfolio";
import { Borrow } from "./ui/Borrow";

type Tab = "liquidity" | "portfolio" | "borrow";
const LS_URL = "pv:rpcUrl", LS_URLS = "pv:rpcUrls";

function remembered(): string[] {
  try { const s = localStorage.getItem(LS_URLS); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return [...CONFIG.rpcDefaults];
}

export default function App() {
  const [url, setUrl] = useState<string>(() => {
    try { const q = new URLSearchParams(globalThis.location?.search ?? "").get("rpc"); if (q) return q; } catch { /* ignore */ }
    try { return localStorage.getItem(LS_URL) || CONFIG.rpcDefaults[0]; } catch { return CONFIG.rpcDefaults[0]; }
  });
  const [urls, setUrls] = useState<string[]>(remembered);
  const [chain, setChain] = useState<Chain | null>(null);
  const [reg, setReg] = useState<Registry | null>(null);
  const [status, setStatus] = useState<string>("not connected");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("liquidity");
  const [gen, setGen] = useState(0);
  // The in-flight connect; a new Connect aborts it so a dead endpoint can't keep the viewer busy.
  const inflight = useRef<AbortController | null>(null);
  const chainRef = useRef<Chain | null>(null);

  const doConnect = useCallback(async (target: string) => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    setError(null); clearTimings();
    const t0 = performance.now();
    const onStatus = (s: string) => { if (!ac.signal.aborted) setStatus(s); };
    try {
      await disconnect(chainRef.current);
      chainRef.current = null; setChain(null); setReg(null);
      const c = await connect(target, onStatus, ac.signal);
      if (ac.signal.aborted) { await disconnect(c); return; }
      onStatus("registry…");
      const r = await loadRegistry(c);
      if (ac.signal.aborted) { await disconnect(c); return; }
      chainRef.current = c; setChain(c); setReg(r);
      setStatus(`${c.chainName} · spec ${c.specVersion} · block ${c.blockNumber.toLocaleString()} · ${c.isFork ? "fork" : "live"} · ${c.url} · connected in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      try { localStorage.setItem(LS_URL, target); const list = Array.from(new Set([target, ...urls])).slice(0, 12); localStorage.setItem(LS_URLS, JSON.stringify(list)); setUrls(list); } catch { /* ignore */ }
      setGen((g) => g + 1);
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer Connect
      setError(String((e as Error).message ?? e)); setStatus("connection failed");
    }
    finally { if (inflight.current === ac) inflight.current = null; }
  }, [urls]);

  useEffect(() => { void doConnect(url); /* on mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <strong className="brand">Protocol Viewer</strong>
        <form className="rpc" onSubmit={(e) => { e.preventDefault(); void doConnect(url); }}>
          <input list="rpcs" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} placeholder="ws://127.0.0.1:8001" />
          <datalist id="rpcs">{urls.map((u) => <option key={u} value={u} />)}</datalist>
          <button type="submit">Connect</button>
          <button type="button" onClick={() => { setGen((g) => g + 1); }} disabled={!chain}>Reload data</button>
        </form>
        <span className={"status" + (error ? " err" : "")}>{error ?? status}</span>
      </header>
      <nav className="tabs">
        {(["liquidity", "portfolio", "borrow"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </nav>
      <main>
        {chain && reg ? (
          tab === "liquidity" ? <Liquidity key={`l${gen}`} chain={chain} reg={reg} /> :
          tab === "portfolio" ? <Portfolio key={`p${gen}`} chain={chain} reg={reg} /> :
          <Borrow key={`b${gen}`} chain={chain} />
        ) : <p className="muted">Connect to an RPC to load data.</p>}
      </main>
      <TimingDrawer />
    </div>
  );
}
