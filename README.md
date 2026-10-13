# Protocol Viewer

Lightweight read-only UI for Hydration: Omnipool / stablepool / concentrated-liquidity overview, one account's portfolio, and the money market, straight from any RPC or chopsticks fork. Spec: `garden` wiki → `note-protocol-viewer-spec`.

Rules: storage reads only, one block pin per view, all EVM reads in one JSON-RPC batch per view, rows paint before prices, every RPC call is timed in the drawer at the bottom of the page.

```sh
npm install
npm run build                      # static bundle in dist/
python3 -m http.server 8090 --directory dist
npx tsx scripts/smoke.ts ws://127.0.0.1:18001 <account> [all|farms,stables,portfolio,cl,borrow]
```

Point the RPC box at `ws://127.0.0.1:8001` (a forwarded fork) or `wss://rpc.hydradx.cloud`.
