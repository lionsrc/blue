# Blue Lotus Network Cloudflare Deployment

This runbook documents the first production deployment for `blue2000.cc`.

## Production Hostnames

- `blue2000.cc`: user portal (Cloudflare Pages)
- `admin.blue2000.cc`: admin portal (Cloudflare Pages, protected by Cloudflare Access)
- `api.blue2000.cc`: management API (Cloudflare Worker + D1)
- `gw.blue2000.cc`: WebSocket proxy gateway (Cloudflare Worker + Durable Object)

## Cloudflare Resource Names

- D1 database: `blue-proxy-management-db`
- management worker: `blue-management-worker`
- proxy worker: `blue-proxy-gateway-worker`
- user portal Pages project: `blue-user-portal`
- admin portal Pages project: `blue-admin-portal`

## Current Pre-Deploy Limits

- The proxy worker currently uses one `BACKEND_HOST` binding. First production deploy should use exactly one active proxy node. Do not mark multiple nodes `active` until the gateway is changed to route each user to their allocated node.
- `admin-web-app` builds, but `npm run lint` still fails. This is not a runtime blocker, but it is unresolved code-quality debt.
- The root [`README.md`](/Users/liondad/dev/blue/README.md) is stale and should not be treated as the deployment source of truth.

## 1. Cloudflare Prerequisites

1. Put `blue2000.cc` on Cloudflare and make sure the zone is active.
2. Install Wrangler and authenticate:

```bash
npx wrangler login
```

3. Decide on the first proxy node public IP. You will use that value as the initial `BACKEND_HOST`.
   The current node bootstrap exposes plain WebSocket on port `443`, so the first deploy should use `BACKEND_SCHEME=http`.

## 2. Create The D1 Database

From [`/Users/liondad/dev/blue/management-worker`](/Users/liondad/dev/blue/management-worker):

```bash
npx wrangler d1 create blue-proxy-management-db
```

Copy the returned database ID into [`/Users/liondad/dev/blue/management-worker/wrangler.toml`](/Users/liondad/dev/blue/management-worker/wrangler.toml) and replace the placeholder `database_id`.

Then initialize the new remote database:

```bash
npx wrangler d1 execute blue-proxy-management-db --remote --file=./schema.sql --yes
```

## 3. Seed Required Database Records

The user subscription flow requires at least:

- one active domain row
- one active node row (after the node starts polling)

Before the first user requests a subscription, insert the gateway domain:

```bash
npx wrangler d1 execute blue-proxy-management-db --remote --command "INSERT INTO Domains (id, domainName, status) VALUES (lower(hex(randomblob(16))), 'gw.blue2000.cc', 'active');" --yes
```

Do not insert standby domains until you actually own and plan to rotate to them.

## 4. Deploy The Management Worker (`api.blue2000.cc`)

From [`/Users/liondad/dev/blue/management-worker`](/Users/liondad/dev/blue/management-worker):

1. Set required secrets:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put AGENT_SECRET
npx wrangler secret put SESSION_TOKEN_SECRET
npx wrangler secret put USAGE_REPORT_SECRET
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

2. Set optional secrets only if needed:

```bash
npx wrangler secret put ADMIN_ALLOW_EMAILS
npx wrangler secret put CORS_ALLOW_ORIGINS
```

`CORS_ALLOW_ORIGINS` should include `https://admin.blue2000.cc` if the admin frontend calls the API cross-origin.

3. Deploy:

```bash
npm run deploy
```

4. In Cloudflare Workers, attach a custom domain to the worker:
   `api.blue2000.cc`

The existing [`/Users/liondad/dev/blue/management-worker/wrangler.toml`](/Users/liondad/dev/blue/management-worker/wrangler.toml) does not declare the custom domain, so attach it in the dashboard unless you choose to add `routes` there later.

## 5. Deploy The Proxy Worker (`gw.blue2000.cc`)

From [`/Users/liondad/dev/blue/cloudflare`](/Users/liondad/dev/blue/cloudflare):

1. Edit [`/Users/liondad/dev/blue/cloudflare/wrangler.toml`](/Users/liondad/dev/blue/cloudflare/wrangler.toml) if needed:
   `BACKEND_HOST` should be your active node origin plus port `443`, and `BACKEND_SCHEME` should stay `http` with the current Xray bootstrap.
   The current file is already set to `198.23.138.147:443`.

2. Set shared secrets:

```bash
npx wrangler secret put SESSION_TOKEN_SECRET
npx wrangler secret put USAGE_REPORT_SECRET
```

These must match the values used by the management worker.

3. Deploy:

```bash
npx wrangler deploy
```

The provided [`/Users/liondad/dev/blue/cloudflare/wrangler.toml`](/Users/liondad/dev/blue/cloudflare/wrangler.toml) already:

- binds the `SESSION_LOCKS` Durable Object
- declares the initial Durable Object migration
- attaches the worker to the custom domain `gw.blue2000.cc`
- uses `BACKEND_SCHEME=http` for the current non-TLS node origin
- points `MANAGEMENT_API_URL` at `https://api.blue2000.cc`

## 6. Deploy The User Portal (`blue2000.cc`)

Build settings for [`/Users/liondad/dev/blue/user-web-app`](/Users/liondad/dev/blue/user-web-app):

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://api.blue2000.cc`

Recommended deployment path:

1. Create a new Cloudflare Pages project.
   Use the project name `blue-user-portal`.
2. Point it at [`/Users/liondad/dev/blue/user-web-app`](/Users/liondad/dev/blue/user-web-app) (Git integration or direct upload).
3. Set the build command and output directory above.
4. Add the custom domain `blue2000.cc`.
5. Optionally add `www.blue2000.cc` and redirect it to the apex.

The app uses client-side routing. Cloudflare Pages' default SPA fallback behavior is sufficient here as long as you do not add a top-level `404.html`.

## 7. Deploy The Admin Portal (`admin.blue2000.cc`)

Build settings for [`/Users/liondad/dev/blue/admin-web-app`](/Users/liondad/dev/blue/admin-web-app):

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://api.blue2000.cc`
- Optional environment variable: `VITE_GRAFANA_URL=https://grafana.blue2000.cc`

Deploy it to a separate Cloudflare Pages project and attach:

- project name: `blue-admin-portal`
- `admin.blue2000.cc`

After the site is live:

1. Protect `admin.blue2000.cc` with Cloudflare Access.
2. Protect `api.blue2000.cc` with Cloudflare Access as well.
3. Set the worker secret `CF_ACCESS_AUD` to the audience of the Access application that fronts the API hostname.

Important: the current worker validates exactly one Access audience. If you protect the API with a different Access application than the one used for the admin site, the API audience is the one that must match `CF_ACCESS_AUD`.

## 8. Bootstrap The First Proxy Node

On the VPS that will run Xray:

1. Register the node in the admin portal, or insert it through the API.
2. Run the bootstrap script with the same `AGENT_SECRET` configured on the management worker.

Example:

```bash
AGENT_SECRET='YOUR_AGENT_SECRET' \
WORKER_URL='https://api.blue2000.cc' \
./scripts/setup_proxy_node.sh
```

If public IP auto-detection is unreliable on that VPS, also provide `NODE_IP`.

When the script succeeds, the node agent should begin polling `/api/agent/config`, the node should move to `active`, and the proxy worker should be able to forward WebSocket traffic to it.

## 9. First Smoke Test

Run these checks after everything is deployed:

1. Open `https://blue2000.cc`, register a user, and log in.
2. Confirm `https://api.blue2000.cc/api/plans` responds.
3. In the admin portal, confirm `/api/admin/session` succeeds behind Access.
4. Add one node and confirm its `lastPing`, `cpuLoad`, and `activeConnections` update.
5. From the user dashboard, fetch the subscription link and confirm it uses `gw.blue2000.cc`.
6. Connect once as a free user and verify a second concurrent connection is rejected.
7. Confirm usage is increasing in the database after a session disconnects.

## 10. Commands Used For Re-Deploys

Management worker:

```bash
cd /Users/liondad/dev/blue/management-worker
npm run deploy
```

Proxy worker:

```bash
cd /Users/liondad/dev/blue/cloudflare
npx wrangler deploy
```

User portal:

```bash
cd /Users/liondad/dev/blue/user-web-app
npm run build
```

Admin portal:

```bash
cd /Users/liondad/dev/blue/admin-web-app
npm run build
```

Then push a new Pages deployment from the Pages project or your Git-connected branch.
