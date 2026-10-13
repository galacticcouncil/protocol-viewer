import type { Chain } from "./client";
import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";

export type AssetType = "Token" | "XYK" | "StableSwap" | "Bond" | "External" | "Erc20";
export type Asset = { id: number; symbol: string; name: string; decimals: number; type: AssetType; ed: bigint; erc20?: string };
export type Registry = { byId: Map<number, Asset>; byErc20: Map<string, Asset> };

let cache: { blockHash: string; reg: Registry } | null = null;

/** Two storage sweeps (assets + locations), cached per session. No runtime calls. */
export async function loadRegistry(chain: Chain): Promise<Registry> {
  if (cache && cache.blockHash === chain.blockHash) return cache.reg;
  const [assets, locations] = await Promise.all([
    chain.at.query.assetRegistry.assets.entries(),
    chain.at.query.assetRegistry.assetLocations.entries(),
  ]);
  const erc20ById = new Map<number, string>();
  for (const [k, v] of locations) {
    const id = (k.args[0] as unknown as { toNumber(): number }).toNumber();
    const j = v.toJSON() as { interior?: { x1?: { accountKey20?: { key?: string } }[] } } | null;
    const key = j?.interior?.x1?.[0]?.accountKey20?.key;
    if (key) erc20ById.set(id, key.toLowerCase());
  }
  const byId = new Map<number, Asset>();
  const byErc20 = new Map<string, Asset>();
  for (const [k, v] of assets) {
    const id = (k.args[0] as unknown as { toNumber(): number }).toNumber();
    const d = (v as unknown as { unwrap(): { toHuman(): unknown; decimals: { toString(): string }; existentialDeposit: { toString(): string } } }).unwrap();
    const h = d.toHuman() as { symbol?: string; name?: string; assetType?: string | Record<string, unknown> };
    const type = (typeof h.assetType === "string" ? h.assetType : Object.keys(h.assetType ?? {})[0] ?? "Token") as AssetType;
    const a: Asset = {
      id, symbol: h.symbol ?? `#${id}`, name: h.name ?? "", type,
      decimals: Number(d.decimals.toString()), ed: BigInt(d.existentialDeposit.toString()),
      erc20: type === "Erc20" ? erc20ById.get(id) : undefined,
    };
    byId.set(id, a);
    if (a.erc20) byErc20.set(a.erc20, a);
  }
  // LRNA (1) is a Token with 12 decimals; HDX (0) native with 12.
  if (!byId.has(0)) byId.set(0, { id: 0, symbol: "HDX", name: "Hydration", decimals: 12, type: "Token", ed: 1_000_000_000_000n });
  cache = { blockHash: chain.blockHash, reg: { byId, byErc20 } };
  return cache.reg;
}

/** ERC-20 holder address for a substrate account: ETH\0-prefixed accounts map to their H160, others to the truncated first 20 bytes. */
export function h160Of(account: string): string {
  const pk = decodeAddress(account);
  const isEth = pk[0] === 0x45 && pk[1] === 0x54 && pk[2] === 0x48 && pk[3] === 0x00 && pk.slice(24).every((b) => b === 0);
  return u8aToHex(isEth ? pk.slice(4, 24) : pk.slice(0, 20));
}

export const human = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;
