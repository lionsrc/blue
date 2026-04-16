# Plan: Allow Nodes to Change Public IP

## Background

- **Agent auth** (`management-worker/src/routes/agent.ts:14-28`): node identified by `X-Node-IP` header, looked up via `SELECT id FROM Nodes WHERE publicIp = ?`. If the IP changes, the lookup 404s and config sync stops.
- **Schema** (`management-worker/schema.sql:37-46`): `Nodes` has `id TEXT PRIMARY KEY`, `publicIp TEXT NOT NULL UNIQUE`. No per-node secret, no stable external identifier beyond the row `id`. `UserAllocations.nodeId` has a `FOREIGN KEY` referencing `Nodes(id)` (`schema.sql:67`).
- **Client exposure**: the VLESS link clients dial points at `domainName:443` (`routes/user.ts:379`) → Cloudflare → `BACKEND_HOST` (`cloudflare/proxy_worker.js:6,198`). The `publicIp` returned in `/subscription` JSON (`user.ts:386`) is informational only. **End-user clients are not broken by an IP change** — only the agent ↔ management worker handshake is.
- **Agent script** (`scripts/node_agent.sh:58-68,134,154`): already auto-detects public IP via `api.ipify.org`, sends it as `X-Node-IP`. It has no persisted identity.
- **Admin flow** (`routes/admin.ts:237-251`): admin creates nodes with `{name, publicIp}`, DB row `id` is generated server-side. Node operator currently has no way to learn that `id`.
- **Deployed env file path**: `setup_proxy_node.sh:99,123` writes `/etc/superproxy/node-agent.env` and the systemd unit sources that same path via `EnvironmentFile=`.
- **Fresh DB bootstrap**: `DEPLOYMENT.md:51` creates databases by applying `schema.sql` directly, not via migrations.

## Goal

Decouple node identity from IP. Agents authenticate via a stable `nodeId` + per-node secret; the worker records the current IP on each sync. An IP change is a normal data update, not an identity break.

---

## Phase 1: Schema Migration (`0003_node_stable_identity.sql`) + Base Schema Update

### Migration (FK-safe rebuild)

`UserAllocations` has `FOREIGN KEY(nodeId) REFERENCES Nodes(id)`, so `DROP TABLE Nodes` fails when allocations exist. The migration must rebuild both tables in the correct order:

```sql
-- 1. Rebuild Nodes: drop UNIQUE on publicIp, add agentTokenHash + ipUpdatedAt
CREATE TABLE Nodes_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    publicIp TEXT NOT NULL,
    status TEXT DEFAULT 'provisioning',
    activeConnections INTEGER DEFAULT 0,
    cpuLoad REAL DEFAULT 0.0,
    lastPing DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    agentTokenHash TEXT,
    ipUpdatedAt DATETIME
);

INSERT INTO Nodes_new (id, name, publicIp, status, activeConnections, cpuLoad, lastPing, createdAt)
    SELECT id, name, publicIp, status, activeConnections, cpuLoad, lastPing, createdAt FROM Nodes;

-- 2. Rebuild UserAllocations to re-point FK at the new table
CREATE TABLE UserAllocations_new (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    xrayUuid TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL,
    speedLimitMbps INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES Users(id),
    FOREIGN KEY(nodeId) REFERENCES Nodes_new(id),
    UNIQUE(nodeId, port)
);

INSERT INTO UserAllocations_new SELECT * FROM UserAllocations;

-- 3. Swap tables
DROP TABLE UserAllocations;
DROP TABLE Nodes;
ALTER TABLE Nodes_new RENAME TO Nodes;
ALTER TABLE UserAllocations_new RENAME TO UserAllocations;

-- 4. Audit trail for IP changes
CREATE INDEX IF NOT EXISTS idx_nodes_public_ip ON Nodes(publicIp);

CREATE TABLE IF NOT EXISTS NodeIpHistory (
    id TEXT PRIMARY KEY,
    nodeId TEXT NOT NULL,
    previousIp TEXT,
    newIp TEXT NOT NULL,
    changedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(nodeId) REFERENCES Nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_node_ip_history_node ON NodeIpHistory(nodeId, changedAt DESC);
```

### Base schema update (`management-worker/schema.sql`)

Update the canonical `Nodes` table definition to match post-migration shape (remove `UNIQUE` on `publicIp`, add `agentTokenHash`, `ipUpdatedAt`). Add `NodeIpHistory` table. This keeps fresh environments (bootstrapped via `DEPLOYMENT.md:51`) in sync with migrated ones.

---

## Phase 2: Token Provisioning

Reuse existing `pbkdf2` helpers in `management-worker/src/auth.ts:160-184`.

### Admin create node (`routes/admin.ts:237-252`)
- Generate `rawToken = crypto.randomUUID() + crypto.randomUUID()` (256 bits entropy).
- Store `agentTokenHash = await hashPassword(rawToken)`.
- Return `{ nodeId, agentToken: rawToken }` **once** in the response.

### New endpoint: `POST /api/admin/nodes/:id/rotate-token`
- Same flow, overwrites hash. Old token immediately rejected.

### New endpoint: `GET /api/admin/nodes/:id/ip-history`
- Returns recent entries from `NodeIpHistory`.

---

## Phase 3: Dual-Mode Agent Auth (`routes/agent.ts`)

The worker must accept **both** auth modes simultaneously throughout the rollout. A node sends one of:

| Mode | Headers | Lookup |
|------|---------|--------|
| Legacy | `X-Node-IP` + `X-Agent-Secret` | `WHERE publicIp = ?` |
| New | `X-Node-Id` + `X-Agent-Token` | `WHERE id = ?` + `verifyPassword` |

Detection logic:

```ts
const nodeId = c.req.header('X-Node-Id');
const agentToken = c.req.header('X-Agent-Token');
const nodeIp = c.req.header('X-Node-IP');
let node: { id: string; agentTokenHash: string | null; publicIp: string } | null = null;

if (nodeId && agentToken) {
    // New token-based auth
    node = await c.env.DB.prepare(
        `SELECT id, agentTokenHash, publicIp FROM Nodes WHERE id = ?`
    ).bind(nodeId).first();
    if (!node || !node.agentTokenHash) return c.json({ error: 'Unauthorized agent' }, 401);

    const ok = await verifyPassword(agentToken, node.agentTokenHash);
    if (!ok) return c.json({ error: 'Unauthorized agent' }, 401);
} else if (nodeIp && agentSecret) {
    // Legacy IP-based auth (existing behavior)
    if (agentSecret !== requireSecret(c, 'AGENT_SECRET')) {
        return c.json({ error: 'Unauthorized agent' }, 401);
    }
    node = await c.env.DB.prepare(
        `SELECT id, agentTokenHash, publicIp FROM Nodes WHERE publicIp = ? AND agentTokenHash IS NULL`
    ).bind(nodeIp).first();
    if (!node) return c.json({ error: 'Node not found in registry' }, 404);
} else {
    return c.json({ error: 'Missing credentials' }, 401);
}
```

**Key point**: legacy nodes that change IP during rollout still break — this is an inherent limitation of IP-based auth. The rollout does not protect legacy nodes from IP changes; it only ensures they keep working at their current IP while the operator migrates them. Operators should migrate nodes to token auth before any planned IP changes.

Legacy path is removed only after all nodes are confirmed on token auth.

---

## Phase 4: IP Self-Report on Sync

Extend `readAgentSyncPayload` (`auth.ts:227-241`) to parse `publicIp` (string, optional).

In agent handler, after auth:

```ts
const reportedIp = syncPayload.publicIp?.trim() || null;
if (reportedIp && reportedIp !== node.publicIp) {
    await c.env.DB.batch([
        c.env.DB.prepare(
            `INSERT INTO NodeIpHistory (id, nodeId, previousIp, newIp) VALUES (?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), node.id, node.publicIp, reportedIp),
        c.env.DB.prepare(
            `UPDATE Nodes SET publicIp = ?, ipUpdatedAt = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(reportedIp, node.id),
    ]);
}
```

Fold into the existing `UPDATE Nodes SET lastPing = ...` when IP is unchanged.

---

## Phase 5: Agent Script (`scripts/node_agent.sh`)

- Add `NODE_ID` and `AGENT_TOKEN` env vars (required for the new path).
- `X-Agent-Secret` can still be sent during the transition window, but token-auth nodes must not depend on it.
- Send the stable-identity headers:
  ```bash
  -H "X-Node-Id: $NODE_ID" \
  -H "X-Agent-Token: $AGENT_TOKEN" \
  ```
- Include `publicIp` in `collect_payload` JSON for both modes. Re-detect every sync cycle (move `detect_public_ip` call inside the loop).

---

## Phase 6: Setup Script (`scripts/setup_proxy_node.sh`)

- Accept `--node-id <uuid> --agent-token <token>` flags (or `NODE_ID`/`AGENT_TOKEN` env).
- Write the canonical env file to `/etc/superproxy/agent.env`, then keep a compatibility symlink at `/etc/superproxy/node-agent.env` for previously bootstrapped machines.
- Write `NODE_ID` and `AGENT_TOKEN` alongside existing vars:
  ```
  NODE_ID=...
  AGENT_TOKEN=...
  AGENT_SECRET=...
  WORKER_URL=...
  ```
- Existing machines: operator can write `/etc/superproxy/agent.env` and restart the service. The updated agent script also sources the legacy env file path if it still exists.

---

## Phase 7: Admin UI (`admin-web-app/src/pages/Dashboard.tsx`)

- After "Add Node" success, show a **one-time modal**: node ID + agent token + copy button + warning that token won't be shown again.
- Add "Rotate token" button per node row.
- Show `ipUpdatedAt` and "IP history" link/modal.

---

## Phase 8: Tests (`management-worker/test/index.spec.ts`)

- Agent sync with valid `(nodeId, token)` → 200, updates `lastPing`.
- Agent sync with wrong token → 401.
- Agent sync with legacy `(nodeIp, agentSecret)` → 200 (backward compat).
- Agent sync with new `publicIp` → row updated, `NodeIpHistory` row inserted.
- Agent sync with unchanged `publicIp` → no history row.
- Two nodes reporting the same IP transiently → both succeed (no UNIQUE conflict).
- Admin create node → response contains `agentToken` exactly once.
- Admin rotate token → old token rejected, new token accepted.

---

## Rollout Order

1. **Ship schema migration + base schema update**. Adds columns, drops unique, creates `NodeIpHistory`. Also update `management-worker/schema.sql` so fresh environments match.
2. **Ship dual-mode worker code**. Accepts both legacy (`X-Node-IP` + `AGENT_SECRET`) and new (`X-Node-Id` + `X-Agent-Token`) auth. Both modes start accepting `publicIp` in the sync payload body. **Legacy nodes keep working at their current IP but still cannot recover from an IP change** — this is documented as a known limitation during rollout.
3. **Ship updated agent script**. Detects which env vars are present and sends the appropriate headers. Starts self-reporting `publicIp` in payload body.
4. **Migrate each node**: admin provisions token via UI → operator adds `NODE_ID` + `AGENT_TOKEN` to `/etc/superproxy/node-agent.env` → restarts service → confirm sync via `lastPing`. **Migrate nodes before any planned IP change.**
5. **Once all nodes confirmed on token auth**, remove legacy path from worker + agent script, remove `AGENT_SECRET` env var requirement.
6. Keep `NodeIpHistory`.

---

## Risks & Open Questions

- **D1 PRAGMA support**: D1 may not honor `PRAGMA foreign_keys = OFF` in migrations. Test on dev DB. Fallback: D1 defaults to FKs off, so the rebuild may work without the pragma — verify.
- **Token leakage in setup**: one-time token travels from admin UI → operator → node. Mitigate with short-lived enrollment tokens if needed. Defer unless scale demands it.
- **Replay attacks**: bearer token replays forever until rotation. Add HMAC over `(timestamp, body)` with token as key and reject > 60s stale if threat model demands it. Defer for now.
- **`BACKEND_HOST` coupling**: `cloudflare/proxy_worker.js:198` reads `env.BACKEND_HOST` from static bindings. If this is a raw IP (not domain), an IP change still breaks traffic regardless of this work. Recommend pointing at a domain or Cloudflare tunnel.
- **Legacy nodes during rollout**: a legacy node that changes IP during the rollout window (steps 2-4) will lose sync and cannot self-recover. Operators must migrate to token auth before any planned IP change. Document this clearly in rollout instructions.

## Out of Scope

- Auto-enrollment / zero-touch provisioning.
- Multi-IP (IPv4 + IPv6) — `publicIp` stays a single string.
- Geographic routing changes.
