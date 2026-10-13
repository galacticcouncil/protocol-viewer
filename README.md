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

## docker

```sh
docker build -t galacticcouncil/protocol-viewer:latest .
docker run --rm -p 8080:8080 galacticcouncil/protocol-viewer:latest
```

The image builds the locked dependencies and serves the static bundle with unprivileged nginx on port 8080. `/healthz` is the container health endpoint. RPC selection stays in the browser; no server configuration or credentials are required.

`docker/stack.lark.yml` deploys behind Lark's existing Traefik proxy and external `gateway` network at `https://protocol-viewer.lark.hydration.cloud`. Publish the image first, pin the stack's image to its release tag and digest, then deploy the stack through Swarmpit as `protocol-viewer`.
