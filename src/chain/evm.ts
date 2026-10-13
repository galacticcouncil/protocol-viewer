// Minimal JSON-RPC client for eth_* over the node's websocket, with batching:
// one batch request = one round trip, and on a chopsticks fork one executor queue entry per call.
import { record } from "./timing";

export type EthCall = { to: string; data: string; block?: string; label?: string };
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class EvmClient {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private seq = 1;
  private pending = new Map<number, Pending>();
  private url: string;
  private timeoutMs: number;
  constructor(url: string, timeoutMs: number) { this.url = url; this.timeoutMs = timeoutMs; }

  private open(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("evm websocket error"));
      ws.onclose = () => { this.ws = null; this.ready = null; for (const p of this.pending.values()) p.reject(new Error("evm websocket closed")); this.pending.clear(); };
      ws.onmessage = (ev) => {
        let msg: unknown; try { msg = JSON.parse(String(ev.data)); } catch { return; }
        const list = Array.isArray(msg) ? msg : [msg];
        for (const m of list as { id?: number; result?: unknown; error?: { message: string } }[]) {
          if (typeof m?.id !== "number") continue;
          const p = this.pending.get(m.id); if (!p) continue; this.pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        }
      };
      this.ws = ws;
    });
    return this.ready;
  }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }

  /** Send one JSON-RPC batch; returns per-call results (string hex) or Error entries. Never throws for a single call failure. */
  async batch(calls: EthCall[], label = "eth_call batch"): Promise<(string | Error)[]> {
    if (calls.length === 0) return [];
    await this.open();
    const t0 = performance.now();
    const ids = calls.map(() => this.seq++);
    const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: ids[i], method: "eth_call", params: [{ to: c.to, data: c.data }, c.block ?? "latest"] }));
    const promises = ids.map((id) => new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject })));
    this.ws!.send(JSON.stringify(body));
    const timer = setTimeout(() => { for (const id of ids) { const p = this.pending.get(id); if (p) { this.pending.delete(id); p.reject(new Error(`timed out after ${this.timeoutMs} ms`)); } } }, this.timeoutMs * Math.max(1, Math.ceil(calls.length / 10)));
    const results = await Promise.all(promises.map((p) => p.then((r) => r as string, (e: Error) => e)));
    clearTimeout(timer);
    const failed = results.filter((r) => r instanceof Error).length;
    record("eth_call×" + calls.length, label, performance.now() - t0, failed === 0, failed ? `${failed} of ${calls.length} failed` : undefined);
    return results;
  }

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    await this.open();
    const id = this.seq++;
    const t0 = performance.now();
    const p = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const timer = setTimeout(() => { const x = this.pending.get(id); if (x) { this.pending.delete(id); x.reject(new Error(`timed out after ${this.timeoutMs} ms`)); } }, this.timeoutMs);
    try { const r = await p; record(method, "", performance.now() - t0, true); return r as T; }
    catch (e) { record(method, "", performance.now() - t0, false, String((e as Error).message)); throw e; }
    finally { clearTimeout(timer); }
  }
}

export const toHex32 = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
