// Every RPC call the page makes is recorded here and shown in the timing drawer.
export type TimingEntry = { id: number; method: string; key: string; ms: number; ok: boolean; at: number; error?: string };

type Listener = (entries: TimingEntry[]) => void;
let entries: TimingEntry[] = [];
let seq = 0;
const listeners = new Set<Listener>();

export function record(method: string, key: string, ms: number, ok: boolean, error?: string) {
  entries = [...entries.slice(-999), { id: ++seq, method, key, ms, ok, at: Date.now(), error }];
  for (const l of listeners) l(entries);
}
export function clearTimings() { entries = []; for (const l of listeners) l(entries); }
export function subscribe(l: Listener) { listeners.add(l); l(entries); return () => { listeners.delete(l); }; }
export function getTimings() { return entries; }

export async function timed<T>(method: string, key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { const r = await fn(); record(method, key, performance.now() - t0, true); return r; }
  catch (e) { record(method, key, performance.now() - t0, false, String((e as Error)?.message ?? e)); throw e; }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms: ${label}`)), ms); }),
  ]);
}
