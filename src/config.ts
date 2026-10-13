// Static configuration. Nothing here is fetched at runtime.
export const CONFIG = {
  rpcDefaults: ["wss://rpc.hydradx.cloud", "ws://127.0.0.1:8000", "ws://127.0.0.1:8001"],
  // Price anchor: HOLLAR sits in the Omnipool and is treated as 1.00 USD.
  anchorAssetId: 222,
  hubAssetId: 1,
  nativeAssetId: 0,
  omnipoolAccount: "13UVJyLnPLowAMzbZewu9zwEGiSMQKniJ2cp4vM4ru2nci9N",
  omnipoolNftCollection: 1337,
  lmNftCollection: 2584,
  // Omnipool LM periods are relay-chain blocks (6 s); Hydration blocks are 2 s.
  relayBlockMs: 6000,
  paraBlockMs: 2000,
  clFeeWindowBlocks: 7200, // ~4 h of Hydration blocks for the CL fee APR
  // Uniswap v3 pools (Gamma-managed) — pool contract + Gamma hypervisor (vault) + its registry share asset id.
  clPools: [
    { label: "aDOT / HOLLAR", pool: "0x5c6208a3c316a801f8996750aa7b6f45fc988548", vault: "0xa206d0959813f17c17c87147271c49065438648a", shareAssetId: 1001354 },
    { label: "atBTC / HOLLAR", pool: "0xdd7e022582d055e35455952f86f76924884a9d1a", vault: "0x18542081631cc92cbeb73c8bf45d2f74bd46bb8e", shareAssetId: 1001359 },
    { label: "aPAXG / HOLLAR", pool: "0x419f96a1a34c422fa581e89c317c1b55563009b4", vault: "0x2d608c585d19866871aeeb22589b5c4867f2c2ad", shareAssetId: 1001360 },
    { label: "GETH / HOLLAR", pool: "0x9e30d2429028a436d48d0e83ac806dcd67ef4ca7", vault: "0x81192f193024696c3294e875a4aaedaccf7d3d89", shareAssetId: 1001361 },
    { label: "GSOL / HOLLAR", pool: "0x16e1cbd04029566244f832a90fecc0752cc3d419", vault: "0x11f2d134814f6ad92423474647638b77c80e902e", shareAssetId: 1001362 },
  ],
  moneyMarket: {
    poolAddressesProvider: "0xf3Ba4D1b50f78301BDD7EAEa9B67822A15FCA691",
    uiPoolDataProvider: "0x112b087b60C1a166130d59266363C45F8aa99db0",
    oracle: "0xAD33C0F0C42C5A0EAA65b5895D2BdB20cb6E8760",
  },
  accounts: [
    { label: "Treasury", address: "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB" },
    { label: "Council msig", address: "16RJh4z1eUHpC3ntre9H2noKGKxihkSqog9PBt9bRbAnj4RE" },
    { label: "IGL msig", address: "12TyzL1tMod3jm2NvQd5egHDbn2TRdbQTUBEUJ25p6yW31xK" },
  ],
  timeouts: { mainnetMs: 8000, forkMs: 25000 },
} as const;

export const isForkUrl = (url: string) => /127\.0\.0\.1|localhost/.test(url);
