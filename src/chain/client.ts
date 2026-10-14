import { ApiPromise, WsProvider } from "@polkadot/api";
import type { ApiDecoration } from "@polkadot/api/types";
import { record } from "./timing";
import { CONFIG, isForkUrl } from "../config";
import { EvmClient } from "./evm";

export type Chain = {
  url: string;
  api: ApiPromise;
  at: ApiDecoration<"promise">;   // storage pinned to blockHash
  blockHash: string;
  blockNumber: number;
  chainName: string;
  specVersion: number;
  isFork: boolean;
  timeoutMs: number;
  evm: EvmClient;
};

// Wrap provider.send so every substrate RPC is timed, with a readable key (storage method / first param).
function instrument(provider: WsProvider) {
  const orig = provider.send.bind(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (provider as any).send = async (method: string, params: unknown[], isCacheable?: boolean, sub?: unknown) => {
    const t0 = performance.now();
    const key = keyOf(method, params);
    try { const r = await orig(method, params, isCacheable, sub as never); record(method, key, performance.now() - t0, true); return r; }
    catch (e) { record(method, key, performance.now() - t0, false, String((e as Error)?.message ?? e)); throw e; }
  };
}
function keyOf(method: string, params: unknown[]): string {
  const p = params?.[0];
  if (method === "state_queryStorageAt" && Array.isArray(p)) return `${p.length} keys`;
  if (typeof p === "string") return p.length > 24 ? p.slice(0, 24) + "…" : p;
  if (Array.isArray(p)) return `[${p.length}]`;
  return "";
}

const META_PREFIX = "pv:metadata:";

/** "same-origin" → ws(s)://<host of this page>. */
export function resolveRpcUrl(url: string): string {
  if (url.trim() !== "same-origin") return url.trim();
  const loc = globalThis.location;
  if (!loc) return "ws://127.0.0.1:8090";
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}`;
}

export async function connect(rawUrl: string, onStatus: (s: string) => void): Promise<Chain> {
  const url = resolveRpcUrl(rawUrl);
  const timeoutMs = isForkUrl(url) ? CONFIG.timeouts.forkMs : CONFIG.timeouts.mainnetMs;
  onStatus("connecting…");
  const provider = new WsProvider(url, 1500, {}, 120_000);
  instrument(provider);
  await provider.isReady;
  onStatus("runtime version…");
  const [genesis, rv] = await Promise.all([
    provider.send<string>("chain_getBlockHash", [0]),
    provider.send<{ specVersion: number }>("state_getRuntimeVersion", []),
  ]);
  const metaKey = `${genesis}-${rv.specVersion}`;
  let metadata: Record<string, `0x${string}`> | undefined;
  try { const cached = localStorage.getItem(META_PREFIX + metaKey); if (cached) metadata = { [metaKey]: cached as `0x${string}` }; } catch { /* no storage */ }
  onStatus(metadata ? "metadata (cached)…" : "metadata (first time, ~1 MB)…");
  const api = await ApiPromise.create({ provider, noInitWarn: true, metadata, throwOnConnect: true });
  if (!metadata) { try { localStorage.setItem(META_PREFIX + metaKey, api.runtimeMetadata.toHex()); } catch { /* ignore quota */ } }
  onStatus("pinning block…");
  const header = await api.rpc.chain.getHeader();
  const blockHash = header.hash.toHex();
  const at = await api.at(blockHash);
  const chainName = (await api.rpc.system.chain()).toString();
  return {
    url, api, at, blockHash, blockNumber: header.number.toNumber(), chainName,
    specVersion: api.runtimeVersion.specVersion.toNumber(), isFork: isForkUrl(url), timeoutMs,
    evm: new EvmClient(url, isForkUrl(url) ? CONFIG.timeouts.evmForkMs : CONFIG.timeouts.evmMainnetMs),
  };
}

export async function disconnect(chain: Chain | null) {
  if (!chain) return;
  try { chain.evm.close(); await chain.api.disconnect(); } catch { /* ignore */ }
}
