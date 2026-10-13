import { encodeFunctionData, decodeFunctionResult, type Abi } from "viem";
import type { Chain } from "../chain/client";
import type { Registry, Asset } from "../chain/registry";
import { h160Of } from "../chain/registry";
import { erc20Abi } from "../abi/minimal";

/** Unwrap an Option<Codec> storage value to its JSON. */
export const unwrapJson = <T = unknown>(v: unknown): T => (v as { unwrap(): { toJSON(): unknown } }).unwrap().toJSON() as T;
export const isSome = (v: unknown): boolean => !!(v as { isSome?: boolean })?.isSome;

/** Parse polkadot-js toJSON numbers (number | hex string | decimal string) into bigint. */
export function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return v.startsWith("0x") ? BigInt(v) : BigInt(v || "0");
  if (v && typeof (v as { toString(): string }).toString === "function") return BigInt((v as { toString(): string }).toString());
  return 0n;
}

export const enc = (abi: Abi, functionName: string, args: unknown[] = []) => encodeFunctionData({ abi, functionName, args } as never);
export const dec = <T = unknown>(abi: Abi, functionName: string, data: string): T => decodeFunctionResult({ abi, functionName, data: data as `0x${string}` } as never) as T;

export type BalanceReq = { account: string; asset: Asset };
export const balKey = (account: string, assetId: number) => `${account}:${assetId}`;

/**
 * Free balances for many (account, asset) pairs in three round trips at most:
 * native → System.Account multi, Erc20 → one eth_call batch, everything else → one Tokens.Accounts multi.
 * Erc20 failures come back as undefined (never zero).
 */
export async function balancesMulti(chain: Chain, _reg: Registry, reqs: BalanceReq[], label = "balances"): Promise<Map<string, bigint | undefined>> {
  const out = new Map<string, bigint | undefined>();
  const native = reqs.filter((r) => r.asset.id === 0);
  const erc = reqs.filter((r) => r.asset.type === "Erc20" && r.asset.erc20);
  const tok = reqs.filter((r) => r.asset.id !== 0 && r.asset.type !== "Erc20");
  const tasks: Promise<void>[] = [];
  if (native.length) tasks.push(chain.at.query.system.account.multi(native.map((r) => r.account)).then((rs) => {
    rs.forEach((r, i) => out.set(balKey(native[i].account, 0), big((r as unknown as { data: { free: unknown } }).data.free)));
  }));
  if (tok.length) tasks.push(chain.at.query.tokens.accounts.multi(tok.map((r) => [r.account, r.asset.id])).then((rs) => {
    rs.forEach((r, i) => out.set(balKey(tok[i].account, tok[i].asset.id), big((r as unknown as { free: unknown }).free)));
  }));
  if (erc.length) tasks.push(chain.evm.batch(erc.map((r) => ({ to: r.asset.erc20!, data: enc(erc20Abi, "balanceOf", [h160Of(r.account)]), label: r.asset.symbol })), `${label}: balanceOf ×${erc.length}`).then((rs) => {
    rs.forEach((r, i) => out.set(balKey(erc[i].account, erc[i].asset.id), r instanceof Error ? undefined : big(dec<bigint>(erc20Abi, "balanceOf", r))));
  }));
  await Promise.all(tasks);
  return out;
}

/** Convenience: one account, many assets → Map<assetId, free>. */
export async function balancesOf(chain: Chain, reg: Registry, account: string, assets: Asset[], label?: string): Promise<Map<number, bigint | undefined>> {
  const m = await balancesMulti(chain, reg, assets.map((asset) => ({ account, asset })), label ?? `balances ${account.slice(0, 6)}`);
  return new Map(assets.map((a) => [a.id, m.get(balKey(account, a.id))]));
}

export const fmtUsd = (n: number | undefined | null) => n == null || !Number.isFinite(n) ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(n < 1 ? 4 : 2)}`;
export const fmtNum = (n: number | undefined | null, d = 4) => n == null || !Number.isFinite(n) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? n.toFixed(0) : n.toFixed(d);
export const fmtPct = (n: number | undefined | null) => n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(2)}%`;
