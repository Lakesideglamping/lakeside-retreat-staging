/**
 * Admin Auth Routes
 * 
 * Authentication endpoints for the admin panel:
 * - POST /api/admin/login — admin login
 * - GET  /api/admin/verify — verify token
 * - GET  /api/admin/2fa/status — 2FA status
 * - POST /api/admin/2fa/setup — setup 2FA
 * - POST /api/admin/2fa/verify — verify 2FA code
 * - POST /api/admin/2fa/disable — disable 2FA
 * - POST /api/admin/change-password — change password
 * - GET  /api/admin/contact-messages — list contact messages
 * - POST /api/admin/send-email — send email
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { verifyAdmin, sendError, ERROR_CODES, escapeHtml, blacklistToken, parseCookies } = require('../middleware/auth');

// --- TOTP Helpers (RFC 6238 / RFC 4226) ---
const TOTP_STEP = 30; // 30-second time window
const TOTP_DIGITS = 6;
const TOTP_ENCRYPTION_ALGO = 'aes-256-gcm';

/**
 * Encrypt a secret for storage using AES-256-GCM.
 * Uses JWT_SECRET (or a dedicated env var) as the key material.
 */
function encryptSecret(plaintext) {
    const keyMaterial = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;
    const key = crypto.createHash('sha256').update(keyMaterial).digest(); // 32 bytes
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(TOTP_ENCRYPTION_ALGO, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

/**
 * Decrypt a stored secret.
 */
function decryptSecret(ciphertext) {
    const keyMaterial = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;
    const key = crypto.createHash('sha256').update(keyMaterial).digest();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(TOTP_ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Generate an HMAC-based one-time password per RFC 4226.
 * @param {Buffer} secretBuf - The raw secret bytes
 * @param {number} counter - The counter value (for TOTP this is floor(time / step))
 * @returns {string} - Zero-padded 6-digit code
 */
function generateHOTP(secretBuf, counter) {
    // Counter must be an 8-byte big-endian buffer
    const counterBuf = Buffer.alloc(8);
    // Write counter as big-endian 64-bit. JS bitwise ops are 32-bit,
    // so we split into high and low 32-bit words.
    const lo = counter & 0xffffffff;
    const hi = Math.floor(counter / 0x100000000) & 0xffffffff;
    counterBuf.writeUInt32BE(hi, 0);
    counterBuf.writeUInt32BE(lo >>> 0, 4);

    const hmac = crypto.createHmac('sha1', secretBuf);
    hmac.update(counterBuf);
    const hmacResult = hmac.digest();

    // Dynamic truncation (RFC 4226 section 5.4)
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const binCode =
        ((hmacResult[offset] & 0x7f) << 24) |
        ((hmacResult[offset + 1] & 0xff) << 16) |
        ((hmacResult[offset + 2] & 0xff) << 8) |
        (hmacResult[offset + 3] & 0xff);

    const otp = binCode % Math.pow(10, TOTP_DIGITS);
    return otp.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Generate a TOTP code for the current time window.
 */
function generateTOTP(secretBuf, timeOffset) {
    const counter = Math.floor((Math.floor(Date.now() / 1000) + (timeOffset || 0)) / TOTP_STEP);
    return generateHOTP(secretBuf, counter);
}

/**
 * Verify a TOTP code, accepting current window +/- 1 step (90 second total window).
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifyTOTP(secretBuf, code) {
    for (const offset of [-TOTP_STEP, 0, TOTP_STEP]) {
        const expected = generateTOTP(secretBuf, offset);
        if (expected.length === code.length &&
            crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
            return true;
        }
    }
    return false;
}

// Stricter rate limiter: 3 attempts per 15 minutes (reduced from 5)
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // limit each IP to 3 login attempts per 15 minutes
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// FAILED LOGIN TRACKER (exponential backoff)
// ==========================================
// Tracks failed login attempts per IP in memory. After 3 consecutive failures,
// a 1-minute lockout is enforced that doubles with each subsequent failure.
// Successful login resets the counter.
const failedLoginAttempts = new Map();

/**
 * Get the failed attempt record for a given IP.
 * Expired records are cleaned up on access.
 */
function getFailedAttempts(ip) {
    const record = failedLoginAttempts.get(ip);
    if (!record) return null;

    // If the lockout has expired and no new failures, clean up
    if (record.lockedUntil && record.lockedUntil < Date.now()) {
        // Keep the count but clear the lock — next failure will re-lock with higher delay
        record.lockedUntil = null;
    }
    return record;
}

/**
 * Record a failed login attempt. After 3 failures, impose exponential backoff.
 * Backoff: 1 min after 3rd failure, 2 min after 4th, 4 min after 5th, etc.
 */
function recordFailedLogin(ip) {
    let record = failedLoginAttempts.get(ip);
    if (!record) {
        record = { count: 0, lockedUntil: null, firstAttempt: Date.now() };
        failedLoginAttempts.set(ip, record);
    }
    record.count += 1;

    if (record.count >= 3) {
        // Exponential backoff: 1 min * 2^(failures - 3)
        // 3 failures = 1 min, 4 = 2 min, 5 = 4 min, 6 = 8 min, etc. Capped at 30 min.
        const exponent = Math.min(record.count - 3, 5); // cap at 2^5 = 32 min
        const delayMs = 60 * 1000 * Math.pow(2, exponent);
        record.lockedUntil = Date.now() + delayMs;
    }

    // Auto-cleanup stale entries after 30 minutes of inactivity
    setTimeout(() => {
        const current = failedLoginAttempts.get(ip);
        if (current && current === record) {
            failedLoginAttempts.delete(ip);
        }
    }, 30 * 60 * 1000);
}

/**
 * Reset failed login counter on successful login.
 */
function resetFailedLogin(ip) {
    failedLoginAttempts.delete(ip);
}

/**
 * Middleware to check if an IP is currently locked out due to failed attempts.
 */
function checkLoginLockout(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const record = getFailedAttempts(ip);

    if (record && record.lockedUntil && record.lockedUntil > Date.now()) {
        const remainingSeconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        return sendError(res, 429, ERROR_CODES.VALIDATION_ERROR,
            `Too many failed login attempts. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            { retryAfterSeconds: remainingSeconds, attempts: record.count }
        );
    }

    next();
}

function createAdminAuthRoutes(deps) {
    const { db, emailTransporter } = deps;

    // --- Helper: get password hash from DB, falling back to env var ---
    function getPasswordHash(callback) {
        db().get("SELECT setting_value FROM system_settings WHERE setting_key = 'admin_password_hash'", (err, row) => {
            if (err || !row || !row.setting_value) {
                // Fall back to environment variable
                return callback(null, process.env.ADMIN_PASSWORD_HASH);
            }
            return callback(null, row.setting_value);
        });
    }

    // --- Login ---
    // Protected by both express-rate-limit (3 req / 15 min) and custom exponential backoff
    router.post('/api/admin/login', adminLimiter, checkLoginLockout, async (req, res) => {
        const clientIp = req.ip || req.connection.remoteAddress;
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Username and password required');
            }

            if (username !== process.env.ADMIN_USERNAME) {
                recordFailedLogin(clientIp);
                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
            }

            // Check DB first for password hash, fall back to env var
            const passwordHash = await new Promise((resolve, reject) => {
                getPasswordHash((err, hash) => {
                    if (err) return reject(err);
                    resolve(hash);
                });
            });

            if (!passwordHash) {
                return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Password hash not configured');
            }

            const isValid = await bcrypt.compare(password, passwordHash);
            if (!isValid) {
                recordFailedLogin(clientIp);

                // Check if this failure triggered a lockout, and inform the user
                const record = getFailedAttempts(clientIp);
                if (record && record.lockedUntil && record.lockedUntil > Date.now()) {
                    const remainingMinutes = Math.ceil((record.lockedUntil - Date.now()) / 60000);
                    return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS,
                        `Invalid credentials. Account locked for ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} due to repeated failures.`);
                }

                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
            }

            // Successful login — reset failed attempt counter
            resetFailedLogin(clientIp);

            const token = jwt.sign(
                { username: username, role: 'admin' },
                process.env.JWT_SECRET,
                {
                    expiresIn: '1h',
                    issuer: 'lakeside-retreat',
                    audience: 'admin-panel'
                }
            );

            res.cookie('auth-token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                maxAge: 60 * 60 * 1000,
                path: '/'
            });

            res.json({
                success: true,
                message: 'Login successful'
            });

        } catch (error) {
            console.error('Admin login error:', error);
            return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Login failed');
        }
    });

    // --- Logout ---
    router.post('/api/admin/logout', (req, res) => {
        // Blacklist the current token so it cannot be reused
        let token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            const cookies = parseCookies(req);
            token = cookies['auth-token'];
        }
        if (token) {
            blacklistToken(token);
        }

        res.clearCookie('auth-token', { path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
        res.json({ success: true, message: 'Logged out' });
    });

    // --- Verify token ---
    router.get('/api/admin/verify', (req, res) => {
        try {
            // Check Authorization header first, then fall back to httpOnly cookie
            let token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                const cookies = require('../middleware/auth').parseCookies(req);
                token = cookies['auth-token'];
            }

            if (!token) {
                return sendError(res, 401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'No token provided');
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            res.json({ valid: true, user: decoded });

        } catch (error) {
            res.status(401).json({ error: 'Invalid token' });
        }
    });

    // --- 2FA Status ---
    router.get('/api/admin/2fa/status', verifyAdmin, (req, res) => {
        db().get("SELECT setting_value FROM system_settings WHERE setting_key = 'admin_2fa_enabled'", (err, row) => {
            res.json({
                success: true,
                twoFactorEnabled: row ? row.setting_value === 'true' : false
            });
        });
    });

    // --- 2FA Setup ---
    router.post('/api/admin/2fa/setup', verifyAdmin, (req, res) => {
        // Generate a proper 20-byte random secret for TOTP
        const secretRaw = crypto.randomBytes(20);
        // Base32-encode the secret for compatibility with authenticator apps
        const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let base32Secret = '';
        let bits = 0;
        let value = 0;
        for (const byte of secretRaw) {
            value = (value << 8) | byte;
            bits += 8;
            while (bits >= 5) {
                base32Secret += base32Chars[(value >>> (bits - 5)) & 0x1f];
                bits -= 5;
            }
        }
        if (bits > 0) {
            base32Secret += base32Chars[(value << (5 - bits)) & 0x1f];
        }

        // Encrypt the raw hex secret before storing in DB
        const encryptedSecret = encryptSecret(secretRaw.toString('hex'));
        db().run(
            "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_2fa_secret', ?, CURRENT_TIMESTAMP)",
            [encryptedSecret],
            (err) => {
                if (err) {
                    console.error('2FA setup error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to setup 2FA' });
                }
                // Return the base32-encoded secret so the user can add it to their authenticator app
                // Also return an otpauth URI for QR code generation
                const issuer = 'LakesideRetreat';
                const account = process.env.ADMIN_USERNAME || 'admin';
                const otpauthUri = `otpauth://totp/${issuer}:${account}?secret=${base32Secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
                res.json({
                    success: true,
                    secret: base32Secret,
                    otpauthUri: otpauthUri,
                    message: 'Scan the QR code or enter the secret in your authenticator app, then verify with a code.'
                });
            }
        );
    });

    // --- 2FA Verify ---
    router.post('/api/admin/2fa/verify', verifyAdmin, (req, res) => {
        const { code } = req.body;
        if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, error: 'A 6-digit verification code is required' });
        }

        db().get("SELECT setting_value FROM system_settings WHERE setting_key = 'admin_2fa_secret'", (err, row) => {
            if (err || !row) {
                return res.status(400).json({ success: false, error: '2FA not configured. Run setup first.' });
            }

            try {
                // Decrypt the stored secret and convert to Buffer for HMAC
                const secretHex = decryptSecret(row.setting_value);
                const secretBuf = Buffer.from(secretHex, 'hex');

                // Verify using proper TOTP (RFC 6238) with +/- 1 time step tolerance
                const isValid = verifyTOTP(secretBuf, code);

                if (isValid) {
                    db().run(
                        "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_2fa_enabled', 'true', CURRENT_TIMESTAMP)",
                        (err) => {
                            if (err) {
                                return res.status(500).json({ success: false, error: 'Failed to enable 2FA' });
                            }
                            res.json({ success: true, message: '2FA enabled successfully' });
                        }
                    );
                } else {
                    res.status(400).json({ success: false, error: 'Invalid verification code. Ensure your authenticator app clock is synced.' });
                }
            } catch (decryptErr) {
                console.error('2FA verify decryption error:', decryptErr);
                return res.status(500).json({ success: false, error: 'Failed to verify 2FA. Secret may be corrupted; please re-run setup.' });
            }
        });
    });

    // --- 2FA Disable ---
    router.post('/api/admin/2fa/disable', verifyAdmin, async (req, res) => {
        try {
            const { currentPassword } = req.body;

            if (!currentPassword) {
                return res.status(400).json({ success: false, error: 'Current password is required to disable 2FA' });
            }

            // Verify password before allowing 2FA disable
            const passwordHash = await new Promise((resolve, reject) => {
                getPasswordHash((err, hash) => {
                    if (err) return reject(err);
                    resolve(hash);
                });
            });

            if (!passwordHash) {
                return res.status(500).json({ success: false, error: 'Password hash not configured' });
            }

            const isValid = await bcrypt.compare(currentPassword, passwordHash);
            if (!isValid) {
                return res.status(401).json({ success: false, error: 'Invalid password' });
            }

            db().run(
                "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_2fa_enabled', 'false', CURRENT_TIMESTAMP)",
                (err) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
                    }
                    res.json({ success: true, message: '2FA disabled' });
                }
            );
        } catch (error) {
            console.error('2FA disable error:', error);
            return res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
        }
    });

    // --- Change password ---
    router.post('/api/admin/change-password', verifyAdmin, async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Current and new passwords required');
            }

            if (newPassword.length < 8) {
                return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'New password must be at least 8 characters');
            }

            // Get current hash from DB first, falling back to env var
            const currentHash = await new Promise((resolve, reject) => {
                getPasswordHash((err, hash) => {
                    if (err) return reject(err);
                    resolve(hash);
                });
            });

            if (!currentHash) {
                return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Password hash not configured');
            }

            const isValid = await bcrypt.compare(currentPassword, currentHash);
            if (!isValid) {
                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect');
            }

            const newHash = await bcrypt.hash(newPassword, 12);

            // Persist the new hash in the database (survives restarts)
            await new Promise((resolve, reject) => {
                db().run(
                    "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_password_hash', ?, CURRENT_TIMESTAMP)",
                    [newHash],
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });

            // Also update process.env for the current running session
            process.env.ADMIN_PASSWORD_HASH = newHash;

            // Blacklist the current token to force re-login
            let currentToken = req.headers.authorization?.split(' ')[1];
            if (!currentToken) {
                const cookies = parseCookies(req);
                currentToken = cookies['auth-token'];
            }
            if (currentToken) {
                blacklistToken(currentToken);
            }

            res.json({ success: true, message: 'Password changed successfully' });
        } catch (error) {
            console.error('Change password error:', error);
            return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to change password');
        }
    });

    // --- Contact messages ---
    router.get('/api/admin/contact-messages', verifyAdmin, (req, res) => {
        db().all('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 50', [], (err, rows) => {
            if (err) {
                console.error('Error fetching contact messages:', err);
                return res.status(500).json({ success: false, error: 'Failed to fetch messages' });
            }
            res.json({ success: true, messages: rows || [] });
        });
    });

    // --- Send email ---
    router.post('/api/admin/send-email', verifyAdmin, (req, res) => {
        const { to, subject, body } = req.body;

        if (!to || !subject || !body) {
            return res.status(400).json({ success: false, error: 'To, subject, and body required' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            return res.status(400).json({ success: false, error: 'Invalid email address' });
        }

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            html: escapeHtml(body)
        };

        emailTransporter.sendMail(mailOptions, (err, _info) => {
            if (err) {
                console.error('Email send error:', err);
                return res.status(500).json({ success: false, error: 'Failed to send email' });
            }
            res.json({ success: true, message: 'Email sent successfully' });
        });
    });

    return router;
}

module.exports = createAdminAuthRoutes;
