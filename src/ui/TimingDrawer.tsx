import { useEffect, useState } from "react";
import { subscribe, type TimingEntry } from "../chain/timing";

export function TimingDrawer() {
  const [entries, setEntries] = useState<TimingEntry[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribe(setEntries), []);
  const total = entries.reduce((s, e) => s + e.ms, 0);
  const failed = entries.filter((e) => !e.ok).length;
  const slowest = [...entries].sort((a, b) => b.ms - a.ms).slice(0, 40);
  const byMethod = new Map<string, { n: number; ms: number }>();
  for (const e of entries) { const m = byMethod.get(e.method) ?? { n: 0, ms: 0 }; m.n++; m.ms += e.ms; byMethod.set(e.method, m); }
  return (
    <div className={"drawer" + (open ? " open" : "")}>
      <button className="drawer-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▼" : "▲"} RPC calls: {entries.length} · {(total / 1000).toFixed(1)} s busy{failed ? ` · ${failed} failed` : ""}
      </button>
      {open && (
        <div className="drawer-body">
          <div className="cols">
            <div>
              <h4>By method</h4>
              <table><tbody>
                {[...byMethod.entries()].sort((a, b) => b[1].ms - a[1].ms).map(([m, v]) => (
                  <tr key={m}><td>{m}</td><td className="num">{v.n}</td><td className="num">{v.ms.toFixed(0)} ms</td></tr>
                ))}
              </tbody></table>
            </div>
            <div>
              <h4>Slowest calls</h4>
              <table><tbody>
                {slowest.map((e) => (
                  <tr key={e.id} className={e.ok ? "" : "fail"}><td>{e.method}</td><td className="key">{e.key}{e.error ? ` — ${e.error}` : ""}</td><td className="num">{e.ms.toFixed(0)} ms</td></tr>
                ))}
              </tbody></table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
