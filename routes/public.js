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
const database = require('../database');
const { sanitizeInput, escapeHtml } = require('../middleware/auth');
const { logger } = require('../logger');

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
    const { db, emailTransporter, accommodationCache, chatbot } = deps;

    // --- Accommodations (cached) ---
    router.get('/api/accommodations',
        accommodationCache.middleware({
            ttl: 600000,
            keyGenerator: (_req) => 'accommodations:all'
        }),
        (req, res) => {
            try {
                res.json({
                    success: true,
                    accommodations: accommodationsConfig.getAll()
                });
            } catch (error) {
                logger.error('Accommodations endpoint error', { error: error.message });
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
                logger.info('Contact form email sent', { from: sanitizedData.email });
            } catch (emailError) {
                logger.error('Failed to send contact email', { error: emailError.message });
            }

            const sql = `
                INSERT INTO contact_messages (name, email, message, created_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `;
            db().run(sql, [sanitizedData.name, sanitizedData.email, sanitizedData.message], function(err) {
                if (err) {
                    logger.error('Failed to store contact message', { error: err.message });
                } else {
                    logger.info('Contact message stored', { id: this.lastID });
                }
            });

            res.json({
                success: true,
                message: 'Thank you for your message! We will get back to you soon.'
            });

        } catch (error) {
            logger.error('Contact form processing error', { error: error.message });
            res.status(500).json({
                success: false,
                error: 'Failed to send message. Please try again.'
            });
        }
    });

    // --- Pricing calculation with seasonal rates ---
    router.get('/api/pricing/calculate', async (req, res) => {
        try {
            const { accommodation, checkin, checkout } = req.query;

            if (!accommodation || !checkin || !checkout) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: accommodation, checkin, checkout'
                });
            }

            const config = accommodationsConfig.getById(accommodation);
            if (!config) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid accommodation'
                });
            }

            const checkInDate = new Date(checkin);
            const checkOutDate = new Date(checkout);
            if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid date range'
                });
            }

            const basePrice = config.basePrice;

            // Query active seasonal rates that overlap the booking date range
            // Use parameterised is_active check for PostgreSQL BOOLEAN compatibility
            const seasonalSql = `
                SELECT name, start_date, end_date, multiplier
                FROM seasonal_rates
                WHERE is_active = ?
                AND start_date <= ? AND end_date >= ?
                ORDER BY multiplier DESC
            `;
            const isActiveVal = database.isUsingPostgres() ? true : 1;

            const seasonalRates = await new Promise((resolve, reject) => {
                db().all(seasonalSql, [isActiveVal, checkout, checkin], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            // Build nightly breakdown
            const nightlyBreakdown = [];
            let subtotal = 0;
            const current = new Date(checkInDate);

            while (current < checkOutDate) {
                const dateStr = current.toISOString().split('T')[0];

                // Find applicable seasonal rate for this night (highest multiplier wins)
                let multiplier = 1.0;
                let seasonName = 'Standard';

                for (const rate of seasonalRates) {
                    if (dateStr >= rate.start_date && dateStr <= rate.end_date) {
                        multiplier = parseFloat(rate.multiplier);
                        seasonName = rate.name;
                        break; // Already sorted by multiplier DESC, take the highest
                    }
                }

                const nightRate = Math.round(basePrice * multiplier);
                nightlyBreakdown.push({
                    date: dateStr,
                    rate: nightRate,
                    multiplier,
                    seasonName
                });
                subtotal += nightRate;

                current.setDate(current.getDate() + 1);
            }

            const totalNights = nightlyBreakdown.length;
            const averageRate = totalNights > 0 ? Math.round(subtotal / totalNights) : basePrice;

            res.json({
                success: true,
                accommodation,
                basePrice,
                nightlyBreakdown,
                averageRate,
                totalNights,
                subtotal
            });

        } catch (error) {
            logger.error('Pricing calculation error', { error: error.message });
            res.status(500).json({
                success: false,
                error: 'Failed to calculate pricing'
            });
        }
    });

    // --- Public pricing ---
    router.get('/api/pricing', (req, res) => {
        res.set('Cache-Control', 'no-store, max-age=0');
        const sql = "SELECT * FROM system_settings WHERE setting_key LIKE 'pricing_%'";
        db().all(sql, [], (err, rows) => {
            if (err) {
                logger.error('Error fetching public pricing', { error: err.message });
                return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
            }

            // Defaults match config/accommodations.js base prices
            const defaultPricing = {
                'dome_pinot': { base: 530, weekend: 530, peak: 530, cleaning: 50, minNights: 1 },
                'dome_rose': { base: 510, weekend: 510, peak: 510, cleaning: 50, minNights: 1 },
                'lakeside_cottage': { base: 295, weekend: 295, peak: 295, cleaning: 50, minNights: 2 }
            };

            const pricing = { ...defaultPricing };
            (rows || []).forEach(row => {
                try {
                    const key = row.setting_key.replace('pricing_', '');
                    pricing[key] = JSON.parse(row.setting_value);
                } catch (e) {
                    logger.error('Error parsing pricing', { error: e.message });
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
            logger.error('Chatbot error', { error: error.message });
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
            logger.error('Clear session error', { error: error.message });
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
                    logger.error('Calendar query error', { error: err.message });
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
            logger.error('Calendar error', { error: error.message });
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
                    logger.error('Weekends query error', { error: err.message });
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
                const current = new Date(today);
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
            logger.error('Weekends error', { error: error.message });
            res.status(500).json({ success: false, error: 'Availability error' });
        }
    });

    // --- SEO-friendly routes: serve standalone HTML pages ---
    const standalonePages = {
        '/stay':         'stay.html',
        '/gallery':      'gallery.html',
        '/guides':       'guides.html',
        '/blog':         'guides.html',
        '/reviews':      'reviews.html',
        '/our-story':    'our-story.html',
        '/story':        'our-story.html',
        '/explore':      'explore.html',
        '/contact':      'contact.html',
        '/dome-pinot':   'dome-pinot.html',
        '/dome-rose':    'dome-rose.html',
        '/lakeside-cottage': 'lakeside-cottage.html',
        '/privacy-policy':   'privacy-policy.html',
        '/terms':            'terms.html',
        '/central-otago-wine-trail':      'central-otago-wine-trail.html',
        '/couples-retreat-central-otago': 'couples-retreat-central-otago.html',
        '/weekend-getaway-queenstown':    'weekend-getaway-queenstown.html',
        '/cromwell-activities':           'cromwell-activities.html',
    };

    Object.entries(standalonePages).forEach(([route, file]) => {
        router.get(route, (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', file));
        });
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
