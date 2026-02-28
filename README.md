# Blue Lotus Network

Blue Lotus Network is a Cloudflare-centered proxy control plane for `blue2000.cc`.

It includes:

- a user portal on Cloudflare Pages
- an admin portal on Cloudflare Pages behind Cloudflare Access
- a management API on Cloudflare Workers + D1
- a WebSocket proxy gateway on Cloudflare Workers + Durable Objects
- bootstrap and polling scripts for Xray proxy nodes
- a separate Prometheus/Grafana monitoring stack

The current codebase is aimed at a first production deployment with one active proxy node.

## Current Product Behavior

- `Free`: `1 Mbps`, `50 GB / month`, one concurrent active session
- `Basic`: `$18 / month`, `300 Mbps`, `200 GB / month`
- `Pro`: `$38 / month`, `600 Mbps`, `500 GB / month`

Implemented today:

- user signup and login
- user plan selection and plan upgrades
- subscription link generation
- signed proxy session tokens
- free-plan single concurrent session enforcement at the Cloudflare edge
- monthly usage tracking and quota cut-off
- node polling for config, health, and allocation updates
- admin user and node management behind Cloudflare Access

## Architecture

### Control Plane

- [`management-worker`](/Users/liondad/dev/blue/management-worker): Hono-based Cloudflare Worker with D1-backed user, node, domain, allocation, payment, and usage data
- [`cloudflare/proxy_worker.js`](/Users/liondad/dev/blue/cloudflare/proxy_worker.js): Cloudflare Worker that validates signed session tokens, enforces free-plan concurrency via a Durable Object, proxies WebSocket traffic to the active node, and reports usage back to the management API

### Frontends

- [`user-web-app`](/Users/liondad/dev/blue/user-web-app): public React + Vite portal for signup, login, subscription access, and plan changes
- [`admin-web-app`](/Users/liondad/dev/blue/admin-web-app): internal React + Vite portal for admin operations and Grafana launch links

### Data Plane

- [`scripts/setup_proxy_node.sh`](/Users/liondad/dev/blue/scripts/setup_proxy_node.sh): manual bootstrap script for a new VPS
- [`scripts/node_agent.sh`](/Users/liondad/dev/blue/scripts/node_agent.sh): polling agent that fetches user allocations and reports node stats

### Monitoring

- [`monitoring`](/Users/liondad/dev/blue/monitoring): standalone Prometheus + Grafana stack intended for a separate VPS

## Current Limits

These are real constraints in the current code, not roadmap items:

- The proxy gateway currently supports only one active backend origin. Do not run multiple `active` nodes in production until the gateway is changed to route per user allocation.
- Monthly quota is reported when a WebSocket session closes. A long-lived session can temporarily exceed quota before disconnect.
- The node receives per-user plan limits, but true per-user bandwidth shaping at the kernel/network layer is not fully implemented yet.
- The admin app builds, but `npm run lint` still reports code-quality issues.

## Repository Layout

- [`management-worker`](/Users/liondad/dev/blue/management-worker): Cloudflare Worker API and D1 schema
- [`cloudflare`](/Users/liondad/dev/blue/cloudflare): proxy Worker and Wrangler config
- [`user-web-app`](/Users/liondad/dev/blue/user-web-app): public frontend
- [`admin-web-app`](/Users/liondad/dev/blue/admin-web-app): admin frontend
- [`scripts`](/Users/liondad/dev/blue/scripts): node bootstrap and sync scripts
- [`monitoring`](/Users/liondad/dev/blue/monitoring): Prometheus/Grafana config
- [`DEPLOYMENT.md`](/Users/liondad/dev/blue/DEPLOYMENT.md): Cloudflare deployment runbook for `blue2000.cc`

## Local Development

### Management Worker

From [`management-worker`](/Users/liondad/dev/blue/management-worker):

```bash
npm install
npm test -- --run
./node_modules/.bin/tsc -p tsconfig.json
npm run dev
```

### User Portal

From [`user-web-app`](/Users/liondad/dev/blue/user-web-app):

```bash
npm install
npm run build
npm run lint
npm run dev
```

Set `VITE_API_URL` if you want it to talk to a non-default API origin.

### Admin Portal

From [`admin-web-app`](/Users/liondad/dev/blue/admin-web-app):

```bash
npm install
npm run build
npm run dev
```

Set:

- `VITE_API_URL`
- optional `VITE_GRAFANA_URL`

The admin app expects the API to be protected by Cloudflare Access in deployed environments.

## Deployment

Use [`DEPLOYMENT.md`](/Users/liondad/dev/blue/DEPLOYMENT.md) as the source of truth for production rollout.

That document covers:

- Cloudflare resource names with the `blue-` prefix
- D1 creation and schema initialization
- deployment of `api.blue2000.cc` and `gw.blue2000.cc`
- deployment of the two Pages apps
- Cloudflare Access setup for admin access
- first node bootstrap and smoke tests

## Security Notes

- Secrets are expected through Wrangler secrets or local `.dev.vars` / `.env` files, not committed config.
- The monitoring stack no longer hardcodes the Grafana admin password. Set `GRAFANA_ADMIN_PASSWORD` in a local `monitoring/.env` file before starting it.
- The admin portal currently relies on Cloudflare Access identity, not a separate in-app admin user table.

## Recommended Next Work

- add per-user gateway routing so multiple active proxy nodes are safe
- tighten quota enforcement with periodic mid-session usage flushes
- implement true per-user bandwidth enforcement on the node
- clean up remaining admin app lint issues
