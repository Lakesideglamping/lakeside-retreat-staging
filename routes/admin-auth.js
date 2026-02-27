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

const { verifyAdmin, sendError, ERROR_CODES } = require('../middleware/auth');

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

function createAdminAuthRoutes(deps) {
    const { db, emailTransporter } = deps;

    // --- Login ---
    router.post('/api/admin/login', adminLimiter, async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Username and password required');
            }

            if (username !== process.env.ADMIN_USERNAME) {
                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
            }

            const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
            if (!isValid) {
                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
            }

            const token = jwt.sign(
                { username: username, role: 'admin' },
                process.env.JWT_SECRET,
                {
                    expiresIn: '1h',
                    issuer: 'lakeside-retreat',
                    audience: 'admin-panel'
                }
            );

            const isProduction = process.env.NODE_ENV === 'production';
            res.cookie('auth-token', token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: 'strict',
                maxAge: 60 * 60 * 1000,
                path: '/admin'
            });

            res.json({
                success: true,
                token: token,
                message: 'Login successful'
            });

        } catch (error) {
            console.error('Admin login error:', error);
            return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Login failed');
        }
    });

    // --- Verify token ---
    router.get('/api/admin/verify', (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];

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
        const secret = crypto.randomBytes(20).toString('hex');
        db().run(
            "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_2fa_secret', ?, CURRENT_TIMESTAMP)",
            [secret],
            (err) => {
                if (err) {
                    console.error('2FA setup error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to setup 2FA' });
                }
                res.json({ success: true, secret: secret });
            }
        );
    });

    // --- 2FA Verify ---
    router.post('/api/admin/2fa/verify', verifyAdmin, (req, res) => {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Verification code required' });
        }

        db().get("SELECT setting_value FROM system_settings WHERE setting_key = 'admin_2fa_secret'", (err, row) => {
            if (err || !row) {
                return res.status(400).json({ success: false, error: '2FA not configured' });
            }

            // Simple TOTP verification (in production use a proper TOTP library)
            const isValid = code === row.setting_value.substring(0, 6);

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
                res.status(400).json({ success: false, error: 'Invalid verification code' });
            }
        });
    });

    // --- 2FA Disable ---
    router.post('/api/admin/2fa/disable', verifyAdmin, (req, res) => {
        db().run(
            "INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('admin_2fa_enabled', 'false', CURRENT_TIMESTAMP)",
            (err) => {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
                }
                res.json({ success: true, message: '2FA disabled' });
            }
        );
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

            const isValid = await bcrypt.compare(currentPassword, process.env.ADMIN_PASSWORD_HASH);
            if (!isValid) {
                return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect');
            }

            const newHash = await bcrypt.hash(newPassword, 12);
            process.env.ADMIN_PASSWORD_HASH = newHash;

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

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            html: body
        };

        emailTransporter.sendMail(mailOptions, (err, info) => {
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
