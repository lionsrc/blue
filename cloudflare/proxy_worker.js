/**
 * proxy_worker.js
 * Cloudflare Worker for reverse-proxying WebSocket traffic to Xray backend nodes.
 *
 * Required bindings:
 * - BACKEND_HOST: host[:port] for the active Xray node origin
 * - SESSION_TOKEN_SECRET: shared with the management worker
 * - SESSION_LOCKS: Durable Object binding for per-user session coordination
 * - MANAGEMENT_API_URL: management worker base URL
 * - USAGE_REPORT_SECRET: shared with the management worker usage endpoint
 */

const textEncoder = new TextEncoder();

function base64UrlToBase64(value) {
    return value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
}

function encodeBytesAsBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function timingSafeEqual(left, right) {
    const leftBytes = textEncoder.encode(left);
    const rightBytes = textEncoder.encode(right);

    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    let diff = 0;
    for (let index = 0; index < leftBytes.length; index += 1) {
        diff |= leftBytes[index] ^ rightBytes[index];
    }

    return diff === 0;
}

async function signSessionPayload(secret, payloadSegment) {
    const key = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadSegment));

    return encodeBytesAsBase64Url(new Uint8Array(signature));
}

async function verifySessionToken(token, secret) {
    const [payloadSegment, signatureSegment, ...rest] = token.split('.');
    if (!payloadSegment || !signatureSegment || rest.length > 0) {
        return null;
    }

    const expectedSignature = await signSessionPayload(secret, payloadSegment);
    if (!timingSafeEqual(expectedSignature, signatureSegment)) {
        return null;
    }

    try {
        const payloadJson = atob(base64UrlToBase64(payloadSegment));
        const payload = JSON.parse(payloadJson);

        if (
            !payload
            || typeof payload.userId !== 'string'
            || typeof payload.planId !== 'string'
            || typeof payload.xrayUuid !== 'string'
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

function buildBackendRequest(request, backendHost, backendPath = '/sp-ws') {
    const backendUrl = new URL(request.url);
    backendUrl.host = backendHost;
    backendUrl.protocol = 'https:';
    backendUrl.pathname = backendPath;

    return new Request(backendUrl.toString(), request);
}

function extractSessionToken(requestUrl) {
    const url = new URL(requestUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length !== 2 || pathParts[0] !== 'sp-ws') {
        return null;
    }

    return decodeURIComponent(pathParts[1]);
}

function websocketUpgradeRequired() {
    return new Response('WebSocket upgrade required', { status: 400 });
}

function sessionRefreshRequired() {
    return new Response('Refresh your subscription link to continue.', { status: 400 });
}

function concurrentSessionRejected() {
    return new Response('Free plan allows only one concurrent active session.', { status: 429 });
}

function getMessageSize(data) {
    if (typeof data === 'string') {
        return textEncoder.encode(data).byteLength;
    }

    if (data instanceof ArrayBuffer) {
        return data.byteLength;
    }

    if (ArrayBuffer.isView(data)) {
        return data.byteLength;
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.size;
    }

    return 0;
}

async function reportUsage(env, userId, bytesUsed) {
    if (!env.MANAGEMENT_API_URL || !env.USAGE_REPORT_SECRET || !userId || bytesUsed <= 0) {
        return;
    }

    const managementUrl = `${env.MANAGEMENT_API_URL.replace(/\/+$/, '')}/api/usage/report`;
    const response = await fetch(managementUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Usage-Secret': env.USAGE_REPORT_SECRET,
        },
        body: JSON.stringify({
            userId,
            bytesUsed,
        }),
    });

    if (!response.ok) {
        throw new Error(`Usage report failed with HTTP ${response.status}`);
    }
}

export class SessionGateDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.activeConnections = new Set();
    }

    async fetch(request) {
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
            return websocketUpgradeRequired();
        }

        const userId = request.headers.get('X-Session-User-Id');
        const planId = request.headers.get('X-Session-Plan-Id');
        if (!userId || !planId) {
            return new Response('Missing session metadata', { status: 400 });
        }

        if (planId === 'free' && this.activeConnections.size > 0) {
            return concurrentSessionRejected();
        }

        if (!this.env.BACKEND_HOST) {
            return new Response('Backend configuration missing', { status: 500 });
        }

        const upstreamResponse = await fetch(buildBackendRequest(request, this.env.BACKEND_HOST, '/sp-ws'));
        if (!upstreamResponse.webSocket) {
            return new Response('Unable to connect to backend websocket', { status: 502 });
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        const upstreamSocket = upstreamResponse.webSocket;

        server.accept();
        upstreamSocket.accept();

        let totalBytesTransferred = 0;
        const currentConnection = { client: server, upstream: upstreamSocket, closed: false };
        this.activeConnections.add(currentConnection);

        const closeConnection = (code = 1000, reason = 'Session closed') => {
            if (currentConnection.closed) {
                return;
            }

            currentConnection.closed = true;
            this.activeConnections.delete(currentConnection);

            if (totalBytesTransferred > 0) {
                const usagePromise = reportUsage(this.env, userId, totalBytesTransferred)
                    .catch((error) => console.error('Failed to report usage', error));

                if (typeof this.state.waitUntil === 'function') {
                    this.state.waitUntil(usagePromise);
                } else {
                    void usagePromise;
                }
            }

            try {
                server.close(code, reason);
            } catch {
                // Ignore close failures after the socket is already closed.
            }

            try {
                upstreamSocket.close(code, reason);
            } catch {
                // Ignore close failures after the socket is already closed.
            }
        };

        server.addEventListener('message', (event) => {
            try {
                totalBytesTransferred += getMessageSize(event.data);
                upstreamSocket.send(event.data);
            } catch {
                closeConnection(1011, 'Failed to forward client traffic');
            }
        });

        upstreamSocket.addEventListener('message', (event) => {
            try {
                totalBytesTransferred += getMessageSize(event.data);
                server.send(event.data);
            } catch {
                closeConnection(1011, 'Failed to forward upstream traffic');
            }
        });

        server.addEventListener('close', () => {
            closeConnection(1000, 'Client disconnected');
        });

        upstreamSocket.addEventListener('close', () => {
            closeConnection(1000, 'Backend disconnected');
        });

        server.addEventListener('error', () => {
            closeConnection(1011, 'Client websocket error');
        });

        upstreamSocket.addEventListener('error', () => {
            closeConnection(1011, 'Backend websocket error');
        });

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }
}

export default {
    async fetch(request, env) {
        try {
            const upgradeHeader = request.headers.get('Upgrade');

            if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
                return new Response('SuperProxy Gateway Active', { status: 200 });
            }

            if (!env.SESSION_TOKEN_SECRET) {
                return new Response('Session token configuration missing', { status: 500 });
            }

            const sessionToken = extractSessionToken(request.url);
            if (!sessionToken) {
                return sessionRefreshRequired();
            }

            const sessionPayload = await verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
            if (!sessionPayload) {
                return new Response('Invalid subscription session token', { status: 401 });
            }

            if (!env.SESSION_LOCKS) {
                return new Response('Session lock binding missing', { status: 500 });
            }

            const lockId = env.SESSION_LOCKS.idFromName(sessionPayload.userId);
            const sessionLock = env.SESSION_LOCKS.get(lockId);
            const proxiedHeaders = new Headers(request.headers);
            proxiedHeaders.set('X-Session-User-Id', sessionPayload.userId);
            proxiedHeaders.set('X-Session-Plan-Id', sessionPayload.planId);
            const proxiedRequest = new Request(request, {
                headers: proxiedHeaders,
            });

            return sessionLock.fetch(proxiedRequest);
        } catch (err) {
            const message = err instanceof Error ? err.stack || err.message : String(err);
            return new Response(message, { status: 500 });
        }
    },
};
