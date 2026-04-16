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
SELECT id, name, publicIp, status, activeConnections, cpuLoad, lastPing, createdAt
FROM Nodes;

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

INSERT INTO UserAllocations_new (id, userId, nodeId, xrayUuid, port, speedLimitMbps, createdAt)
SELECT id, userId, nodeId, xrayUuid, port, speedLimitMbps, createdAt
FROM UserAllocations;

DROP TABLE UserAllocations;
DROP TABLE Nodes;

ALTER TABLE Nodes_new RENAME TO Nodes;
ALTER TABLE UserAllocations_new RENAME TO UserAllocations;

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
