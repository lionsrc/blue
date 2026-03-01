import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Bindings } from '../types.js';
import {
    jwt, authenticateToken, authRateLimiter, paymentRateLimiter,
    requireSecret, getOptionalBinding, hashPassword, verifyPassword, signProxySessionToken,
    encodeBase64, LEGACY_HASH_SCHEME_PREFIX, JWT_EXPIRY_SECONDS,
} from '../auth.js';
import {
    PLAN_ORDER,
    resolvePlanId, getPlanDefinition, getPackageSelection,
    getCurrentPeriodBytesUsed, getPlanMonthlyQuotaBytes,
    isQuotaExceeded, bytesToGb, getUsagePeriodStart,
} from '../plans.js';

const ALLOCATION_PORT_MIN_VAL = 10000;
const ALLOCATION_PORT_MAX_VAL = 50000;

const user = new Hono<{ Bindings: Bindings }>();

user.get('/api/plans', async (c) => {
    return c.json({
        plans: PLAN_ORDER.map((planId) => ({
            ...getPlanDefinition(planId),
        })),
    });
});

user.post('/api/signup', authRateLimiter, async (c: any) => {
    const { email, password, lang } = await c.req.json();
    if (!email || !password) return c.json({ error: "Email and password required" }, 400);

    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedEmail.split('@')[1]?.includes('.')) {
        return c.json({ error: 'Valid email address required' }, 400);
    }

    if (typeof password !== 'string' || password.length < 6) {
        return c.json({ error: 'Password must be at least 6 characters' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const userId = uuidv4();
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 15 * 60 * 1000;
    const verificationPayload = `${verificationCode}:${expiry}`;

    try {
        await c.env.DB.prepare(
            `INSERT INTO Users (id, email, passwordHash, emailVerified, verificationCode) VALUES (?, ?, ?, 0, ?)`
        ).bind(userId, trimmedEmail, passwordHash, verificationPayload).run();
    } catch (error) {
        return c.json({ error: "User already exists or database error" }, 500);
    }

    // Send verification email via Resend
    const isZh = lang === 'zh';
    try {
        const resendApiKey = requireSecret(c, 'RESEND_API_KEY');
        const fromEmail = getOptionalBinding(c, 'RESEND_FROM_EMAIL') || 'onboarding@resend.dev';

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [trimmedEmail],
                subject: isZh ? '验证您的邮箱 — Blue Lotus Network' : 'Verify your email — Blue Lotus Network',
                html: isZh
                    ? `<h2>欢迎使用 Blue Lotus Network！</h2><p>您的验证码为：</p><h1 style="letter-spacing: 6px; font-size: 36px; text-align: center; padding: 20px; background: #f0f0f0; border-radius: 8px;">${verificationCode}</h1><p>请在验证页面输入此验证码以激活您的账户。</p>`
                    : `<h2>Welcome to Blue Lotus Network!</h2><p>Your verification code is:</p><h1 style="letter-spacing: 6px; font-size: 36px; text-align: center; padding: 20px; background: #f0f0f0; border-radius: 8px;">${verificationCode}</h1><p>Enter this code on the verification page to activate your account.</p>`,
            }),
        });
    } catch (err) {
        console.error('Failed to send verification email:', err);
        // Account is created but email may fail — user can request resend
    }

    return c.json({ message: "User created. Please verify your email.", requiresVerification: true });
});

user.post('/api/login', authRateLimiter, async (c: any) => {
    const { email, password } = await c.req.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    const dbUser = await c.env.DB.prepare(
        `SELECT id, email, passwordHash, tier, subscriptionPlan, isActive, emailVerified FROM Users WHERE email = ?`
    ).bind(normalizedEmail).first();

    if (!dbUser) {
        return c.json({ error: "Invalid credentials" }, 401);
    }

    if (!dbUser.isActive) {
        return c.json({ error: "Account is blocked" }, 403);
    }

    if (!dbUser.emailVerified) {
        return c.json({ error: "Please verify your email before logging in", requiresVerification: true }, 403);
    }

    const passwordValid = await verifyPassword(password, dbUser.passwordHash);

    // Auto-upgrade legacy sha256 hashes to PBKDF2 on successful login
    if (passwordValid && dbUser.passwordHash.startsWith(LEGACY_HASH_SCHEME_PREFIX)) {
        const upgradedHash = await hashPassword(password);
        await c.env.DB.prepare(`UPDATE Users SET passwordHash = ? WHERE id = ?`).bind(upgradedHash, dbUser.id).run();
    }

    if (!passwordValid) {
        return c.json({ error: "Invalid credentials" }, 401);
    }

    let accessToken: string;
    try {
        const planId = resolvePlanId(dbUser.subscriptionPlan, dbUser.tier);
        const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS;
        accessToken = await jwt.sign({ id: dbUser.id, email: dbUser.email, tier: planId, exp }, requireSecret(c, 'JWT_SECRET'));
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Missing required secret:')) {
            return c.json({ error: err.message }, 500);
        }
        throw err;
    }
    return c.json({ accessToken });
});

// --- Email Verification ---

user.post('/api/verify-email', authRateLimiter, async (c: any) => {
    const { email, code } = await c.req.json();

    if (!email || !code) {
        return c.json({ error: 'Email and verification code required' }, 400);
    }

    const dbUser = await c.env.DB.prepare(
        `SELECT id, verificationCode, emailVerified FROM Users WHERE email = ?`
    ).bind(email.trim().toLowerCase()).first();

    if (!dbUser) {
        return c.json({ error: 'User not found' }, 404);
    }

    if (dbUser.emailVerified) {
        return c.json({ message: 'Email already verified' });
    }

    const storedPayload = dbUser.verificationCode;
    if (!storedPayload) {
        return c.json({ error: 'Invalid verification code' }, 400);
    }

    const [storedCode, expiresAtStr] = storedPayload.split(':');

    if (storedCode !== String(code).trim()) {
        return c.json({ error: 'Invalid verification code' }, 400);
    }

    if (expiresAtStr && Date.now() > parseInt(expiresAtStr, 10)) {
        return c.json({ error: 'Verification code expired. Please request a new one.' }, 400);
    }

    await c.env.DB.prepare(
        `UPDATE Users SET emailVerified = 1, verificationCode = NULL WHERE id = ?`
    ).bind(dbUser.id).run();

    return c.json({ message: 'Email verified successfully. You can now log in.' });
});

user.post('/api/resend-verification', authRateLimiter, async (c: any) => {
    const { email, lang } = await c.req.json();

    if (!email) {
        return c.json({ error: 'Email required' }, 400);
    }

    const dbUser = await c.env.DB.prepare(
        `SELECT id, emailVerified FROM Users WHERE email = ?`
    ).bind(email.trim().toLowerCase()).first();

    if (!dbUser) {
        return c.json({ error: 'User not found' }, 404);
    }

    if (dbUser.emailVerified) {
        return c.json({ message: 'Email already verified' });
    }

    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 15 * 60 * 1000;
    const verificationPayload = `${verificationCode}:${expiry}`;

    await c.env.DB.prepare(
        `UPDATE Users SET verificationCode = ? WHERE id = ?`
    ).bind(verificationPayload, dbUser.id).run();

    const isZh = lang === 'zh';
    try {
        const resendApiKey = requireSecret(c, 'RESEND_API_KEY');
        const fromEmail = getOptionalBinding(c, 'RESEND_FROM_EMAIL') || 'onboarding@resend.dev';

        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [email.trim().toLowerCase()],
                subject: isZh ? '验证您的邮箱 — Blue Lotus Network' : 'Verify your email — Blue Lotus Network',
                html: isZh
                    ? `<h2>您的新验证码</h2><h1 style="letter-spacing: 6px; font-size: 36px; text-align: center; padding: 20px; background: #f0f0f0; border-radius: 8px;">${verificationCode}</h1><p>请在验证页面输入此验证码以激活您的账户。</p>`
                    : `<h2>Your new verification code</h2><h1 style="letter-spacing: 6px; font-size: 36px; text-align: center; padding: 20px; background: #f0f0f0; border-radius: 8px;">${verificationCode}</h1><p>Enter this code on the verification page to activate your account.</p>`,
            }),
        });
    } catch (err) {
        console.error('Failed to resend verification email:', err);
        return c.json({ error: 'Failed to send verification email' }, 500);
    }

    return c.json({ message: 'Verification code sent' });
});

user.get('/api/me', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');
    const currentUser = await c.env.DB.prepare(
        `SELECT id, email, tier, subscriptionPlan, bandwidthLimitMbps, creditBalance, isActive, subscriptionEndDate,
		        currentUsagePeriodStart, currentPeriodBytesUsed
		 FROM Users WHERE id = ?`
    ).bind(tokenUser.id).first();

    if (!currentUser) {
        return c.json({ error: 'User not found' }, 404);
    }

    if (!currentUser.isActive) {
        return c.json({ error: 'Account is blocked' }, 403);
    }

    let planId = resolvePlanId(currentUser.subscriptionPlan, currentUser.tier);

    // Downgrade expired subscriptions to free
    if (planId !== 'free' && currentUser.subscriptionEndDate) {
        if (new Date(currentUser.subscriptionEndDate) < new Date()) {
            planId = 'free';
        }
    }

    const effectivePlan = getPlanDefinition(planId);
    const currentPeriodBytesUsed = getCurrentPeriodBytesUsed(
        currentUser.currentUsagePeriodStart,
        currentUser.currentPeriodBytesUsed,
    );
    const quotaExceeded = isQuotaExceeded(planId, currentPeriodBytesUsed);
    const remainingTrafficBytes = Math.max(0, getPlanMonthlyQuotaBytes(planId) - currentPeriodBytesUsed);

    return c.json({
        user: {
            id: currentUser.id,
            email: currentUser.email,
            tier: planId,
            subscriptionPlan: planId,
            bandwidthLimitMbps: effectivePlan.bandwidthLimitMbps,
            monthlyTrafficLimitGb: effectivePlan.monthlyTrafficLimitGb,
            deviceLimit: effectivePlan.deviceLimit,
            creditBalance: currentUser.creditBalance ?? 0,
            subscriptionEndDate: currentUser.subscriptionEndDate ?? null,
            currentPeriodBytesUsed,
            currentPeriodUsageGb: bytesToGb(currentPeriodBytesUsed),
            remainingTrafficBytes,
            remainingTrafficGb: bytesToGb(remainingTrafficBytes),
            quotaExceeded,
        },
    });
});

user.get('/api/subscription', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');
    const currentUser = await c.env.DB.prepare(
        `SELECT id, tier, subscriptionPlan, subscriptionEndDate, bandwidthLimitMbps, isActive, currentUsagePeriodStart, currentPeriodBytesUsed
		 FROM Users WHERE id = ?`
    ).bind(tokenUser.id).first();

    if (!currentUser) {
        return c.json({ error: 'User not found' }, 404);
    }

    if (!currentUser.isActive) {
        return c.json({ error: 'Account is blocked' }, 403);
    }

    let planId = resolvePlanId(currentUser.subscriptionPlan, currentUser.tier);

    // Downgrade expired subscriptions to free
    if (planId !== 'free' && currentUser.subscriptionEndDate) {
        if (new Date(currentUser.subscriptionEndDate) < new Date()) {
            planId = 'free';
        }
    }

    const activePlan = getPlanDefinition(planId);
    const effectiveBandwidthLimit = activePlan.bandwidthLimitMbps;
    const currentPeriodBytesUsed = getCurrentPeriodBytesUsed(
        currentUser.currentUsagePeriodStart,
        currentUser.currentPeriodBytesUsed,
    );

    if (isQuotaExceeded(planId, currentPeriodBytesUsed)) {
        return c.json({ error: 'Monthly traffic quota exceeded. Upgrade or wait for the next monthly reset.' }, 403);
    }

    // 1. Fetch user allocation
    let allocation = await c.env.DB.prepare(
        `SELECT a.xrayUuid, a.port, a.speedLimitMbps, n.publicIp, d.domainName 
     FROM UserAllocations a
     JOIN Nodes n ON a.nodeId = n.id
     JOIN Domains d ON d.status = 'active'
     WHERE a.userId = ? LIMIT 1`
    ).bind(tokenUser.id).first();

    // 2. If no allocation exists, allocate them to the least busy node
    if (!allocation) {
        const bestNode = await c.env.DB.prepare(
            `SELECT id, publicIp FROM Nodes WHERE status = 'active' ORDER BY activeConnections ASC LIMIT 1`
        ).first();

        const activeDomain = await c.env.DB.prepare(`SELECT domainName FROM Domains WHERE status = 'active' LIMIT 1`).first();

        if (!bestNode || !activeDomain) {
            return c.json({ error: "No active proxy nodes or domains available currently." }, 503);
        }

        // Find an unused port on this node
        const { results: existingAllocations } = await c.env.DB.prepare(
            `SELECT port FROM UserAllocations WHERE nodeId = ?`
        ).bind(bestNode.id).all() as { results: { port: number }[] };
        const usedPorts = new Set(existingAllocations.map((a: { port: number }) => a.port));

        let port: number | null = null;
        for (let candidate = ALLOCATION_PORT_MIN_VAL; candidate <= ALLOCATION_PORT_MAX_VAL; candidate++) {
            if (!usedPorts.has(candidate)) {
                port = candidate;
                break;
            }
        }

        if (port === null) {
            return c.json({ error: 'No available ports on the proxy node.' }, 503);
        }

        const xrayUuid = uuidv4();
        const speedLimit = effectiveBandwidthLimit;

        await c.env.DB.prepare(
            `INSERT INTO UserAllocations (id, userId, nodeId, xrayUuid, port, speedLimitMbps) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(uuidv4(), currentUser.id, bestNode.id, xrayUuid, port, speedLimit).run();

        // Update active connections count on the node
        await c.env.DB.prepare(`UPDATE Nodes SET activeConnections = activeConnections + 1 WHERE id = ?`).bind(bestNode.id).run();

        allocation = { xrayUuid, port, speedLimitMbps: speedLimit, publicIp: bestNode.publicIp, domainName: activeDomain.domainName };
    } else if (allocation.speedLimitMbps !== effectiveBandwidthLimit) {
        await c.env.DB.prepare(
            `UPDATE UserAllocations SET speedLimitMbps = ? WHERE userId = ?`
        ).bind(effectiveBandwidthLimit, currentUser.id).run();
        allocation = { ...allocation, speedLimitMbps: effectiveBandwidthLimit };
    }

    // 3. Generate a session token
    const sessionToken = await signProxySessionToken(c, {
        userId: currentUser.id,
        planId,
        xrayUuid: allocation.xrayUuid as string,
        issuedAt: Date.now(),
    });

    // 4. Build the VLESS link
    const websocketPath = `/sp-ws?token=${encodeURIComponent(sessionToken)}`;
    const vlessLink = `vless://${allocation.xrayUuid}@${allocation.domainName}:443?encryption=none&security=tls&type=ws&host=${allocation.domainName}&path=${websocketPath}`;

    // Base64 encode the link for standard subscription clients
    const base64Encoded = encodeBase64(vlessLink);

    return c.json({
        message: "Subscription active.",
        nodeIP: allocation.publicIp,
        connectionPort: 443,
        speedLimitMbps: allocation.speedLimitMbps,
        planId,
        vlessLink,
        subscriptionUrlData: base64Encoded
    });
});

// --- Payment Processing ---
user.post('/api/payments/process', paymentRateLimiter, authenticateToken, async (c: any) => {
    const currentUser = c.get('user');
    const { amount, currency, paymentMethod, packageId } = await c.req.json();

    const selectedPackage = getPackageSelection(packageId);
    if (!selectedPackage) {
        return c.json({ error: `Unknown package: ${packageId}` }, 400);
    }

    const paymentId = uuidv4();

    try {
        const activePlan = getPlanDefinition(selectedPackage.planId);

        let newEndDate: string | null = null;
        if (selectedPackage.monthsToAdd !== null && selectedPackage.monthsToAdd > 0) {
            const now = new Date();
            now.setMonth(now.getMonth() + selectedPackage.monthsToAdd);
            newEndDate = now.toISOString();
        }

        const insertPayment = c.env.DB.prepare(
            `INSERT INTO Payments (id, userId, amount, currency, status, paymentMethod, packageId) VALUES (?, ?, ?, ?, 'completed', ?, ?)`
        ).bind(paymentId, currentUser.id, amount ?? selectedPackage.expectedAmount, currency ?? 'USD', paymentMethod ?? null, packageId);

        const updateUser = c.env.DB.prepare(
            `UPDATE Users SET tier = ?, subscriptionPlan = ?, bandwidthLimitMbps = ?, subscriptionEndDate = COALESCE(?, subscriptionEndDate) WHERE id = ?`
        ).bind(selectedPackage.planId, selectedPackage.planId, activePlan.bandwidthLimitMbps, newEndDate, currentUser.id);

        const updateAllocations = c.env.DB.prepare(
            `UPDATE UserAllocations SET speedLimitMbps = ? WHERE userId = ?`
        ).bind(activePlan.bandwidthLimitMbps, currentUser.id);

        await c.env.DB.batch([insertPayment, updateUser, updateAllocations]);

        return c.json({
            success: true,
            paymentId,
            newSubscriptionEnd: newEndDate,
            user: {
                tier: selectedPackage.planId,
                subscriptionPlan: selectedPackage.planId,
                bandwidthLimitMbps: activePlan.bandwidthLimitMbps,
                monthlyTrafficLimitGb: activePlan.monthlyTrafficLimitGb,
                deviceLimit: activePlan.deviceLimit,
            }
        });
    } catch (e: any) {
        return c.json({ error: 'Payment processing failed', details: e.message }, 500);
    }
});

// --- Account Management ---

user.put('/api/change-email', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');
    const { newEmail } = await c.req.json();

    if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
        return c.json({ error: 'Valid email address required' }, 400);
    }

    const normalizedEmail = newEmail.trim().toLowerCase();

    try {
        const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiry = Date.now() + 15 * 60 * 1000;
        const verificationPayload = `${verificationCode}:${expiry}`;

        await c.env.DB.prepare(
            `UPDATE Users SET email = ?, emailVerified = 0, verificationCode = ? WHERE id = ?`
        ).bind(normalizedEmail, verificationPayload, tokenUser.id).run();

        // Send new verification email
        try {
            const resendApiKey = requireSecret(c, 'RESEND_API_KEY');
            const fromEmail = getOptionalBinding(c, 'RESEND_FROM_EMAIL') || 'onboarding@resend.dev';

            // Assume English for change-email if lang param not passed, since we only have newEmail in this payload
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: fromEmail,
                    to: [normalizedEmail],
                    subject: 'Verify your new email — Blue Lotus Network',
                    html: `<h2>Email Address Updated</h2><p>Your new verification code is:</p><h1 style="letter-spacing: 6px; font-size: 36px; text-align: center; padding: 20px; background: #f0f0f0; border-radius: 8px;">${verificationCode}</h1><p>Please log in again and enter this code on the verification page to activate your account with this new email.</p>`,
                }),
            });
        } catch (err) {
            console.error('Failed to send target verification email:', err);
        }

        return c.json({ message: 'Email updated successfully. Please log in to verify your new email.', email: normalizedEmail, requiresVerification: true });
    } catch (error: any) {
        if (error.message?.includes('UNIQUE')) {
            return c.json({ error: 'Email already in use' }, 409);
        }
        return c.json({ error: 'Failed to update email' }, 500);
    }
});

user.put('/api/change-password', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');
    const { currentPassword, newPassword } = await c.req.json();

    if (!currentPassword || !newPassword) {
        return c.json({ error: 'Current password and new password required' }, 400);
    }

    if (newPassword.length < 6) {
        return c.json({ error: 'New password must be at least 6 characters' }, 400);
    }

    const currentUser = await c.env.DB.prepare(
        `SELECT passwordHash FROM Users WHERE id = ?`
    ).bind(tokenUser.id).first();

    if (!currentUser) {
        return c.json({ error: 'User not found' }, 404);
    }

    const passwordValid = await verifyPassword(currentPassword, currentUser.passwordHash);
    if (!passwordValid) {
        return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare(`UPDATE Users SET passwordHash = ? WHERE id = ?`).bind(newHash, tokenUser.id).run();

    return c.json({ message: 'Password updated successfully' });
});

user.delete('/api/account', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');

    try {
        await c.env.DB.batch([
            c.env.DB.prepare(`DELETE FROM UserAllocations WHERE userId = ?`).bind(tokenUser.id),
            c.env.DB.prepare(`DELETE FROM Payments WHERE userId = ?`).bind(tokenUser.id),
            c.env.DB.prepare(`DELETE FROM Users WHERE id = ?`).bind(tokenUser.id),
        ]);

        return c.json({ message: 'Account deleted successfully' });
    } catch {
        return c.json({ error: 'Failed to delete account' }, 500);
    }
});

user.get('/api/payments/history', authenticateToken, async (c: any) => {
    const tokenUser = c.get('user');

    const { results: payments } = await c.env.DB.prepare(
        `SELECT id, amount, currency, status, paymentMethod, packageId, createdAt
		 FROM Payments WHERE userId = ? ORDER BY createdAt DESC`
    ).bind(tokenUser.id).all();

    return c.json({ payments: payments || [] });
});

export default user;
