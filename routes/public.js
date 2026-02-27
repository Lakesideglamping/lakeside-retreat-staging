/**
 * Public Routes
 * 
 * Unauthenticated endpoints for the customer-facing website:
 * - GET  /api/accommodations — list accommodations (cached)
 * - POST /api/contact — contact form submission
 * - GET  /api/pricing — public pricing display
 * - POST /api/chatbot/message — chatbot conversations
 * - POST /api/chatbot/clear-session — clear chatbot session
 * - GET  /api/availability-calendar — monthly availability calendar
 * - GET  /api/availability-weekends — next available weekends
 * - SEO-friendly page routes (catch-all)
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');

const accommodationsConfig = require('../config/accommodations');
const { sanitizeInput, escapeHtml } = require('../middleware/auth');

// ==========================================
// RATE LIMITERS
// ==========================================

const contactLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: { error: 'Too many messages sent, please try again in 10 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

const chatbotLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { error: 'Too many messages, please slow down' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// MODULE SETUP
// ==========================================

/**
 * Initialize public routes with shared dependencies.
 * @param {Object} deps - Shared dependencies from server.js
 * @param {Object} deps.db - Database connection
 * @param {Object} deps.emailTransporter - Nodemailer transporter
 * @param {Object} deps.accommodationCache - Cache middleware
 * @param {Object} deps.chatbot - ChatbotService instance
 * @param {Object} deps.marketingAutomation - MarketingAutomation instance
 * @param {Object} deps.database - Database abstraction layer
 */
function createPublicRoutes(deps) {
    const { db, emailTransporter, accommodationCache, chatbot, getMarketingAutomation, database } = deps;

    // --- Accommodations (cached) ---
    router.get('/api/accommodations',
        accommodationCache.middleware({
            ttl: 600000,
            keyGenerator: (req) => 'accommodations:all'
        }),
        (req, res) => {
            try {
                res.json({
                    success: true,
                    accommodations: accommodationsConfig.getAll()
                });
            } catch (error) {
                console.error('❌ Accommodations endpoint error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to load accommodations'
                });
            }
        }
    );

    // --- Contact form ---
    router.post('/api/contact', contactLimiter, [
        body('name').trim().isLength({ min: 2, max: 100 }).escape(),
        body('email')
            .isEmail()
            .matches(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)
            .normalizeEmail({
                gmail_remove_dots: false,
                gmail_remove_subaddress: false,
                outlookdotcom_remove_subaddress: false,
                yahoo_remove_subaddress: false,
                icloud_remove_subaddress: false
            }),
        body('message').trim().isLength({ min: 10, max: 1000 }).escape(),
        body('subject').optional().trim().isLength({ max: 200 }).escape()
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid contact form data',
                    details: errors.array()
                });
            }

            const { name, email, message } = req.body;
            const sanitizedData = {
                name: sanitizeInput(name),
                email: email,
                message: sanitizeInput(message)
            };

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.CONTACT_EMAIL || process.env.EMAIL_USER,
                subject: `Website Contact from ${escapeHtml(sanitizedData.name)}`,
                html: `
                    <h2>New Contact Form Submission</h2>
                    <p><strong>Name:</strong> ${escapeHtml(sanitizedData.name)}</p>
                    <p><strong>Email:</strong> ${escapeHtml(sanitizedData.email)}</p>
                    <p><strong>Message:</strong></p>
                    <p>${escapeHtml(sanitizedData.message).replace(/\n/g, '<br>')}</p>
                    <hr>
                    <p><small>Sent from Lakeside Retreat website contact form</small></p>
                `,
                replyTo: sanitizedData.email
            };

            try {
                await emailTransporter.sendMail(mailOptions);
                console.log('✅ Contact form email sent from:', sanitizedData.email);
            } catch (emailError) {
                console.error('❌ Failed to send contact email:', emailError);
            }

            const sql = `
                INSERT INTO contact_messages (name, email, message, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `;
            db().run(sql, [sanitizedData.name, sanitizedData.email, sanitizedData.message], function(err) {
                if (err) {
                    console.error('❌ Failed to store contact message:', err);
                } else {
                    console.log('✅ Contact message stored with ID:', this.lastID);
                }
            });

            res.json({
                success: true,
                message: 'Thank you for your message! We will get back to you soon.'
            });

        } catch (error) {
            console.error('❌ Contact form processing error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send message. Please try again.'
            });
        }
    });

    // --- Public pricing ---
    router.get('/api/pricing', (req, res) => {
        res.set('Cache-Control', 'no-store, max-age=0');
        const sql = "SELECT * FROM system_settings WHERE setting_key LIKE 'pricing_%'";
        db().all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error fetching public pricing:', err);
                return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
            }

            const defaultPricing = {
                'dome_pinot': { base: 500, weekend: 530, peak: 600, cleaning: 50, minNights: 2 },
                'dome_rose': { base: 500, weekend: 530, peak: 600, cleaning: 50, minNights: 2 },
                'lakeside_cottage': { base: 305, weekend: 325, peak: 365, cleaning: 50, minNights: 2 }
            };

            const pricing = { ...defaultPricing };
            (rows || []).forEach(row => {
                try {
                    const key = row.setting_key.replace('pricing_', '');
                    pricing[key] = JSON.parse(row.setting_value);
                } catch (e) {
                    console.error('Error parsing pricing:', e);
                }
            });

            res.json({ success: true, pricing });
        });
    });

    // --- Chatbot ---
    router.post('/api/chatbot/message', chatbotLimiter, async (req, res) => {
        try {
            const { message, sessionId } = req.body;

            if (!message || typeof message !== 'string' || message.trim().length === 0) {
                return res.status(400).json({ error: 'Message is required' });
            }

            if (message.length > 500) {
                return res.status(400).json({ error: 'Message too long (max 500 characters)' });
            }

            const response = await chatbot.processMessage(message.trim(), sessionId || 'default');

            res.json({
                success: true,
                response: response.message,
                sessionId: response.sessionId,
                suggestions: response.suggestions || []
            });
        } catch (error) {
            console.error('Chatbot error:', error);
            res.status(500).json({
                error: 'Sorry, I encountered an error. Please try again.'
            });
        }
    });

    router.post('/api/chatbot/clear-session', (req, res) => {
        try {
            const { sessionId } = req.body;
            if (sessionId) {
                chatbot.clearSession(sessionId);
            }
            res.json({ success: true });
        } catch (error) {
            console.error('Clear session error:', error);
            res.status(500).json({ error: 'Failed to clear session' });
        }
    });

    // --- Availability calendar ---
    router.get('/api/availability-calendar', async (req, res) => {
        try {
            const { accommodation, month, year } = req.query;

            if (!accommodation) {
                return res.status(400).json({ success: false, error: 'Accommodation parameter required' });
            }

            const targetMonth = parseInt(month) || new Date().getMonth() + 1;
            const targetYear = parseInt(year) || new Date().getFullYear();

            const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
            const endDate = new Date(targetYear, targetMonth, 0);
            const endDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

            const sql = `SELECT check_in, check_out FROM bookings 
                         WHERE accommodation = ? 
                         AND status IN ('confirmed', 'pending')
                         AND check_out >= ? AND check_in <= ?`;

            db().all(sql, [accommodation, startDate, endDateStr], (err, bookings) => {
                if (err) {
                    console.error('Calendar query error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to load calendar' });
                }

                const blockedDates = new Set();
                (bookings || []).forEach(booking => {
                    const start = new Date(booking.check_in);
                    const end = new Date(booking.check_out);
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        blockedDates.add(d.toISOString().split('T')[0]);
                    }
                });

                res.json({
                    success: true,
                    month: targetMonth,
                    year: targetYear,
                    accommodation,
                    blockedDates: Array.from(blockedDates)
                });
            });
        } catch (error) {
            console.error('Calendar error:', error);
            res.status(500).json({ success: false, error: 'Calendar error' });
        }
    });

    // --- Next available weekends ---
    router.get('/api/availability-weekends', async (req, res) => {
        try {
            const { accommodation, count } = req.query;

            if (!accommodation) {
                return res.status(400).json({ success: false, error: 'Accommodation parameter required' });
            }

            const maxCount = Math.min(parseInt(count) || 4, 12);
            const today = new Date();
            const searchEnd = new Date(today);
            searchEnd.setMonth(searchEnd.getMonth() + 3);

            const sql = `SELECT check_in, check_out FROM bookings 
                         WHERE accommodation = ? 
                         AND status IN ('confirmed', 'pending')
                         AND check_out >= ?`;

            db().all(sql, [accommodation, today.toISOString().split('T')[0]], (err, bookings) => {
                if (err) {
                    console.error('Weekends query error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to check availability' });
                }

                const blockedDates = new Set();
                (bookings || []).forEach(booking => {
                    const start = new Date(booking.check_in);
                    const end = new Date(booking.check_out);
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        blockedDates.add(d.toISOString().split('T')[0]);
                    }
                });

                const availableWeekends = [];
                let current = new Date(today);
                while (current <= searchEnd && availableWeekends.length < maxCount) {
                    const dayOfWeek = current.getDay();
                    if (dayOfWeek === 5) {
                        const friday = current.toISOString().split('T')[0];
                        const saturday = new Date(current);
                        saturday.setDate(saturday.getDate() + 1);
                        const sunday = new Date(current);
                        sunday.setDate(sunday.getDate() + 2);

                        if (!blockedDates.has(friday) && !blockedDates.has(saturday.toISOString().split('T')[0])) {
                            availableWeekends.push({
                                checkIn: friday,
                                checkOut: sunday.toISOString().split('T')[0],
                                nights: 2
                            });
                        }
                    }
                    current.setDate(current.getDate() + 1);
                }

                res.json({
                    success: true,
                    accommodation,
                    availableWeekends
                });
            });
        } catch (error) {
            console.error('Weekends error:', error);
            res.status(500).json({ success: false, error: 'Availability error' });
        }
    });

    // --- SEO-friendly routes ---
    const seoPages = {
        '/': { page: 'home', title: 'Central Otago Luxury Glamping Dome Accommodation' },
        '/stay': { page: 'stay', title: 'Accommodation - Luxury Glamping Domes & Cottage' },
        '/gallery': { page: 'gallery', title: 'Photo Gallery - Lake Dunstan Views & Interiors' },
        '/guides': { page: 'blog', title: 'Local Guides - Wine Tours, Cycling & Activities' },
        '/blog': { page: 'blog', title: 'Local Guides - Wine Tours, Cycling & Activities' },
        '/reviews': { page: 'reviews', title: 'Guest Reviews - 4.9 Star Rating' },
        '/story': { page: 'story', title: 'Our Story - Meet Stephen & Sandy' },
        '/explore': { page: 'explore', title: 'Explore Central Otago - Wineries, Cycling & Activities' },
        '/contact': { page: 'contact', title: 'Contact Us - Bookings & Enquiries' }
    };

    Object.keys(seoPages).forEach(route => {
        if (route !== '/') {
            router.get(route, (req, res) => {
                res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
            });
        }
    });

    // SPA catch-all — MUST be registered last in server.js
    router.spaFallback = (req, res) => {
        if (req.path.startsWith('/api/') ||
            req.path.startsWith('/images/') ||
            req.path === '/sw.js' ||
            req.path.includes('.js') ||
            req.path.includes('.css') ||
            req.path.includes('.png') ||
            req.path.includes('.jpg') ||
            req.path.includes('.jpeg') ||
            req.path.includes('.ico') ||
            req.path.includes('.webp')) {
            return res.status(404).send('Not Found');
        }
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    };

    return router;
}

module.exports = createPublicRoutes;
