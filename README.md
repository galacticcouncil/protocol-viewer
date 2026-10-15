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

Every push to `main` automatically builds and deploys to `https://protocol-viewer.lark.hydration.cloud` through `.github/workflows/deploy.yml`. The workflow can also be run manually from GitHub Actions on `main`.

Deployment runs lint, builds the locked dependencies, publishes a commit-tagged Docker image, and updates the `protocol-viewer` Swarmpit stack using `docker/stack.lark.yml` with the new image digest. Rollouts start the replacement before stopping the old container and roll back on container failure. CI verifies `/healthz` and the deployed commit at `/version.txt`.

Repository Actions secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, and `LARK_SWARMPIT_TOKEN`. The image pinned in the checked-in stack is a manual fallback; CI writes the current release into Swarmpit's saved stack on every deployment.
