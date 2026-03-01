-- Create Users Table
CREATE TABLE IF NOT EXISTS Users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    tier TEXT DEFAULT 'free', -- 'free', 'basic', or 'pro'
    bandwidthLimitMbps INTEGER DEFAULT 1,
    creditBalance REAL DEFAULT 0.0, -- Added for top-ups
    isActive BOOLEAN DEFAULT 1,
    subscriptionPlan TEXT DEFAULT 'free', -- 'free', 'basic', or 'pro'
    subscriptionEndDate DATETIME,
    totalBytesUsed INTEGER DEFAULT 0,
    currentUsagePeriodStart DATETIME,
    currentPeriodBytesUsed INTEGER DEFAULT 0,
    lastConnectTime DATETIME,
    lastConnectIp TEXT,
    lastClientSoftware TEXT,
    emailVerified BOOLEAN DEFAULT 0,
    verificationCode TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create Payments History Table
CREATE TABLE IF NOT EXISTS Payments (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    paymentMethod TEXT, -- 'stripe', 'crypto', 'alipay', etc.
    packageId TEXT, -- Reference to the plan bought (e.g. '1_month_pro')
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES Users(id)
);

-- Create Proxy Nodes Table
CREATE TABLE IF NOT EXISTS Nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    publicIp TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'provisioning', -- 'provisioning', 'active', 'offline', 'blocked'
    activeConnections INTEGER DEFAULT 0, -- Track load balancing
    cpuLoad REAL DEFAULT 0.0,
    lastPing DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create Domains Table (for active WebSocket routes)
CREATE TABLE IF NOT EXISTS Domains (
    id TEXT PRIMARY KEY,
    domainName TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'standby', -- 'active', 'standby', 'blocked'
    cloudflareZoneId TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create User Node Allocations (maps Users to Nodes with specific Xray settings)
CREATE TABLE IF NOT EXISTS UserAllocations (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    xrayUuid TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL,
    speedLimitMbps INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES Users(id),
    FOREIGN KEY(nodeId) REFERENCES Nodes(id),
    UNIQUE(nodeId, port) -- Ensure no port conflicts on a single node
);
