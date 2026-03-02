/**
 * Booking Routes
 * 
 * Handles all booking-related public endpoints:
 * - GET  /api/blocked-dates — blocked dates for date picker
 * - POST /api/availability — check availability
 * - POST /api/process-booking — legacy endpoint (redirects)
 * - POST /api/create-booking — legacy endpoint (redirects)
 * - POST /api/bookings — main booking creation
 * - POST /api/payments/create-session — Stripe payment session
 * - GET  /api/booking/:id — get booking status
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const { sendError, sanitizeInput, ERROR_CODES } = require('../middleware/auth');
const accommodations = require('../config/accommodations');
const database = require('../database');
const { logger } = require('../logger');

const bookingLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { error: 'Too many booking attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for Stripe payment session creation: 10 requests per 15 minutes per IP
const stripeSessionLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many booking attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Initialize booking routes with shared dependencies.
 * @param {Object} deps
 * @param {Function} deps.db - Returns database connection
 * @param {Object} deps.stripe - Stripe instance (or null in dev)
 * @param {boolean} deps.DEV_MODE - Whether running in dev mode
 * @param {Object} deps.bookingQueue - Request queue for bookings
 * @param {Object} deps.paymentQueue - Request queue for payments
 * @param {Object} deps.database - Database module for transactions
 * @param {Function} deps.sendBookingConfirmation - Email confirmation sender
 * @param {Function} [deps.uplisting] - Returns Uplisting service instance (optional)
 * @param {Object} deps.tracking - Booking tracking functions
 */
function createBookingRoutes(deps) {
    const {
        db, stripe, DEV_MODE, bookingQueue, paymentQueue,
        database, checkAvailability, sendBookingConfirmation,
        tracking: { trackBookingStart, trackBookingStep, trackBookingSuccess, trackBookingFailure }
    } = deps;

    const getUplisting = deps.uplisting || (() => null);

    // In-memory cache for Uplisting blocked dates (keyed by accommodation)
    const uplistingBlockedDatesCache = {};
    const UPLISTING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // --- Blocked dates ---
    router.get('/api/blocked-dates', async (req, res) => {
        const { accommodation } = req.query;

        if (!accommodation) {
            return res.status(400).json({ success: false, error: 'Accommodation parameter required' });
        }

        try {
            const sql = `
                SELECT check_in, check_out
                FROM bookings
                WHERE accommodation = ?
                AND status IN ('confirmed', 'pending')
                AND check_out >= date('now')
            `;

            db().all(sql, [accommodation], async (err, rows) => {
                if (err) {
                    logger.error('Error fetching blocked dates:', { error: err?.message });
                    return res.json({ success: true, blockedDates: [] });
                }

                const localDates = new Set();
                rows.forEach(booking => {
                    const start = new Date(booking.check_in);
                    const end = new Date(booking.check_out);
                    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
                        localDates.add(d.toISOString().split('T')[0]);
                    }
                });

                // Try to merge Uplisting blocked dates (cached, fail gracefully)
                let uplistingDates = [];
                try {
                    const uplistingService = getUplisting();
                    if (uplistingService?.isConfigured) {
                        const cached = uplistingBlockedDatesCache[accommodation];
                        const now = Date.now();

                        if (cached && (now - cached.timestamp) < UPLISTING_CACHE_TTL) {
                            uplistingDates = cached.dates;
                        } else {
                            uplistingDates = await uplistingService.fetchBlockedDatesFromUplisting(accommodation);
                            uplistingBlockedDatesCache[accommodation] = { dates: uplistingDates, timestamp: now };
                        }
                    }
                } catch (uplistingErr) {
                    logger.warn('Uplisting blocked dates fetch failed, using local only:', { error: uplistingErr.message });
                }

                // Merge and deduplicate
                for (const date of uplistingDates) {
                    localDates.add(date);
                }

                res.json({ success: true, blockedDates: [...localDates].sort() });
            });
        } catch (error) {
            logger.error('Error in blocked-dates endpoint:', { error: error?.message });
            res.json({ success: true, blockedDates: [] });
        }
    });

    // --- Availability check ---
    router.post('/api/availability', async (req, res) => {
        const { accommodation, checkIn, checkOut, guests: _guests, propertyId: _propertyId } = req.body;

        if (!accommodation || !checkIn || !checkOut) {
            return res.status(400).json({ success: false, error: 'Missing required fields', available: false });
        }

        try {
            const isAvailable = checkAvailability
                ? await checkAvailability(accommodation, checkIn, checkOut)
                : true;

            logger.info(`📅 Availability check for ${accommodation}: ${checkIn} to ${checkOut} - ${isAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);

            res.json({
                success: true,
                available: isAvailable,
                source: checkAvailability ? 'uplisting+local' : 'default'
            });
        } catch (error) {
            logger.error('Error in availability endpoint:', { error: error?.message });
            return res.status(503).json({ success: false, available: false, error: 'Service temporarily unavailable' });
        }
    });

    // --- Legacy endpoints ---
    router.post('/api/process-booking', bookingLimiter, async (req, res) => {
        logger.warn('⚠️ Legacy endpoint /api/process-booking called - redirecting to /api/bookings');
        const legacyData = req.body;
        req.body = {
            firstName: legacyData.guest_name?.split(' ')[0] || '',
            lastName: legacyData.guest_name?.split(' ').slice(1).join(' ') || '',
            email: legacyData.guest_email,
            phone: legacyData.guest_phone,
            accommodation: legacyData.accommodation,
            checkin: legacyData.check_in,
            checkout: legacyData.check_out,
            guests: legacyData.guests,
            totalAmount: legacyData.total_price,
            specialRequests: legacyData.notes
        };
        res.redirect(307, '/api/bookings');
    });

    router.post('/api/create-booking', bookingLimiter, async (req, res) => {
        logger.warn('⚠️ Legacy endpoint /api/create-booking called - redirecting to /api/bookings');
        res.redirect(307, '/api/bookings');
    });

    // --- Main booking creation ---
    router.post('/api/bookings',
        bookingLimiter,
        bookingQueue.middleware({ queueName: 'booking', priority: 'high' }),
        [
            body('firstName').trim().isLength({ min: 2, max: 100 }).escape(),
            body('lastName').trim().isLength({ min: 2, max: 100 }).escape(),
            body('email').isEmail().normalizeEmail(),
            body('phone').optional().custom((value) => {
                if (!value) return true;
                const phoneRegex = /^[\+]?[\d\s\-\(\)\.]{7,20}$/;
                if (!phoneRegex.test(value)) {
                    throw new Error('Please enter a valid phone number');
                }
                return true;
            }),
            body('accommodation').isIn(['dome-pinot', 'dome-rose', 'lakeside-cottage']),
            body('checkin').isISO8601().toDate(),
            body('checkout').isISO8601().toDate(),
            body('guests').isInt({ min: 1, max: 8 }),
            body('totalAmount').isFloat({ min: 0 }),
            body('specialRequests').optional().isLength({ max: 500 }).escape()
        ],
        async (req, res) => {
            try {
                const errors = validationResult(req);
                if (!errors.isEmpty()) {
                    return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid booking data', errors.array());
                }

                const {
                    accommodation, checkin, checkout, guests,
                    firstName, lastName, email, phone,
                    specialRequests, totalAmount
                } = req.body;

                logger.info('📝 Processing booking request for:', { accommodation });
                trackBookingStart(req.body, req.requestId);
                trackBookingStep('validation', req.requestId, { accommodation });

                const sanitizedData = {
                    guest_name: sanitizeInput(`${firstName} ${lastName}`),
                    guest_email: email,
                    guest_phone: sanitizeInput(phone),
                    accommodation: accommodation,
                    check_in: new Date(checkin).toISOString().split('T')[0],
                    check_out: new Date(checkout).toISOString().split('T')[0],
                    guests: parseInt(guests),
                    total_price: parseFloat(totalAmount),
                    notes: sanitizeInput(specialRequests)
                };

                // Validate dates
                const checkInDate = new Date(sanitizedData.check_in);
                const checkOutDate = new Date(sanitizedData.check_out);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (checkInDate < today) {
                    return sendError(res, 400, ERROR_CODES.INVALID_DATE_RANGE, 'Check-in date cannot be in the past');
                }
                if (checkOutDate <= checkInDate) {
                    return sendError(res, 400, ERROR_CODES.INVALID_DATE_RANGE, 'Check-out date must be after check-in date');
                }

                // Validate guests against accommodation maxGuests
                const accommodationConfig = accommodations.getById(sanitizedData.accommodation);
                if (!accommodationConfig) {
                    return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid accommodation');
                }
                const maxGuests = accommodationConfig.maxGuests || 6;
                if (sanitizedData.guests > maxGuests) {
                    return res.status(400).json({ success: false, error: `Maximum ${maxGuests} guests for ${accommodationConfig.name}` });
                }

                // Validate minimum stay
                const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
                const minStay = accommodationConfig.minStay || 1;
                if (nights < minStay) {
                    return res.status(400).json({ success: false, error: `Minimum stay for ${accommodationConfig.name} is ${minStay} nights` });
                }

                // Children policy — domes are adults only
                if (accommodationConfig && accommodationConfig.adultsOnly === true) {
                    const children = parseInt(req.body.children) || 0;
                    if (children > 0) {
                        return res.status(400).json({
                            success: false,
                            error: `${accommodationConfig.name} is an adults-only accommodation. Children are not permitted.`
                        });
                    }
                }

                // Server-side price validation (accounts for seasonal multipliers)
                let expectedAccommodationCost = accommodationConfig.basePrice * nights;
                try {
                    const seasonalSql = `
                        SELECT name, start_date, end_date, multiplier
                        FROM seasonal_rates
                        WHERE is_active = ?
                        AND start_date <= ? AND end_date >= ?
                    `;
                    const isActiveVal = database.isUsingPostgres() ? true : 1;
                    const seasonalRates = await new Promise((resolve, reject) => {
                        db().all(seasonalSql, [isActiveVal, sanitizedData.check_out, sanitizedData.check_in], (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        });
                    });

                    if (seasonalRates.length > 0) {
                        // Recalculate expected cost per night with seasonal multipliers
                        expectedAccommodationCost = 0;
                        const current = new Date(checkInDate);
                        while (current < checkOutDate) {
                            const dateStr = current.toISOString().split('T')[0];
                            let multiplier = 1.0;
                            for (const rate of seasonalRates) {
                                if (dateStr >= rate.start_date && dateStr <= rate.end_date) {
                                    const rateMultiplier = parseFloat(rate.multiplier);
                                    if (rateMultiplier > multiplier) {
                                        multiplier = rateMultiplier;
                                    }
                                }
                            }
                            expectedAccommodationCost += Math.round(accommodationConfig.basePrice * multiplier);
                            current.setDate(current.getDate() + 1);
                        }
                    }
                } catch (seasonalErr) {
                    // If seasonal query fails, fall back to base price calculation
                    logger.error('Seasonal rate query failed during validation:', { error: seasonalErr.message });
                }

                // Extra guest fees (cottage only: $100/extra guest/night for guests beyond 2)
                let expectedExtraGuestFee = 0;
                if (accommodationConfig.extraGuestFee && sanitizedData.guests > 2) {
                    expectedExtraGuestFee = (sanitizedData.guests - 2) * accommodationConfig.extraGuestFee * nights;
                }
                // Pet fee: $50 flat per stay (cottage only, if pets present)
                const pets = parseInt(req.body.pets) || 0;
                const expectedPetFee = (accommodationConfig.petFee && pets > 0) ? accommodationConfig.petFee : 0;

                const cleaningFee = 75;
                const expectedTotal = expectedAccommodationCost + expectedExtraGuestFee + expectedPetFee + cleaningFee;
                const minExpected = expectedTotal * 0.9;
                const maxExpected = expectedTotal * 1.1;
                if (sanitizedData.total_price < minExpected || sanitizedData.total_price > maxExpected) {
                    return res.status(400).json({ success: false, error: 'Price validation failed. Please try again.' });
                }

                trackBookingStep('availability_check', req.requestId, {
                    checkIn: sanitizedData.check_in,
                    checkOut: sanitizedData.check_out
                });

                const bookingId = uuidv4();

                const booking = await database.transaction(async (tx) => {
                    // Atomic availability check inside transaction
                    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
                    const availSql = `
                        SELECT COUNT(*) as conflicts
                        FROM bookings
                        WHERE accommodation = ?
                        AND (payment_status = 'completed' OR (status = 'pending' AND created_at > ?))
                        AND (
                            (check_in <= ? AND check_out > ?) OR
                            (check_in < ? AND check_out >= ?) OR
                            (check_in >= ? AND check_out <= ?)
                        )
                    `;
                    const row = await tx.get(availSql, [
                        sanitizedData.accommodation,
                        thirtyMinAgo,
                        sanitizedData.check_in, sanitizedData.check_in,
                        sanitizedData.check_out, sanitizedData.check_out,
                        sanitizedData.check_in, sanitizedData.check_out
                    ]);

                    // PostgreSQL COUNT(*) returns bigint as string; Number() handles both
                    if (Number(row?.conflicts ?? 0) > 0) {
                        throw { isAvailabilityConflict: true };
                    }

                    // Insert booking within same transaction
                    const insertSql = `
                        INSERT INTO bookings (
                            id, guest_name, guest_email, guest_phone,
                            accommodation, check_in, check_out, guests,
                            total_price, status, payment_status, notes, booking_source, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, 'website', CURRENT_TIMESTAMP)
                    `;
                    await tx.run(insertSql, [
                        bookingId,
                        sanitizedData.guest_name, sanitizedData.guest_email,
                        sanitizedData.guest_phone, sanitizedData.accommodation,
                        sanitizedData.check_in, sanitizedData.check_out,
                        sanitizedData.guests, sanitizedData.total_price,
                        sanitizedData.notes || ''
                    ]);

                    trackBookingStep('database_save', req.requestId, { bookingId });

                    return {
                        id: bookingId,
                        guest_name: sanitizedData.guest_name,
                        guest_email: sanitizedData.guest_email,
                        guest_phone: sanitizedData.guest_phone,
                        accommodation: sanitizedData.accommodation,
                        check_in: sanitizedData.check_in,
                        check_out: sanitizedData.check_out,
                        guests: sanitizedData.guests,
                        total_price: sanitizedData.total_price,
                        status: 'pending',
                        payment_status: 'pending'
                    };
                });

                trackBookingSuccess(booking.id, req.requestId, booking.total_price);

                // Send booking confirmation email (non-blocking)
                if (sendBookingConfirmation) {
                    try {
                        await sendBookingConfirmation(booking);
                    } catch (emailErr) {
                        logger.error('Booking confirmation email failed:', { error: emailErr.message });
                    }
                }

                res.status(201).json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    message: 'Booking created successfully',
                    data: { booking }
                });

            } catch (error) {
                if (error.isAvailabilityConflict) {
                    return sendError(res, 409, ERROR_CODES.DATES_NOT_AVAILABLE, 'Selected dates are not available');
                }
                logger.error('❌ Booking creation error:', { error: error?.message });
                trackBookingFailure(error, req.requestId, 'unknown');
                return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to create booking', error.message);
            }
        }
    );

    // --- Payment session ---
    router.post('/api/payments/create-session',
        stripeSessionLimit,
        paymentQueue.middleware({ queueName: 'payment', priority: 'high' }),
        async (req, res) => {
            try {
                const { bookingId } = req.body;

                if (!bookingId) {
                    return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Booking ID is required');
                }

                if (DEV_MODE || !stripe) {
                    const mockSessionId = 'dev_mock_session_' + bookingId;
                    logger.info('⚠️ DEV_MODE: Returning mock payment session for booking', { bookingId });

                    // Store mock session ID so /booking-success can look it up
                    try {
                        await new Promise((resolve, reject) => {
                            db().run('UPDATE bookings SET stripe_session_id = ? WHERE id = ?',
                                [mockSessionId, bookingId], (err) => err ? reject(err) : resolve());
                        });
                    } catch (dbErr) {
                        logger.error('Failed to store mock session ID', { bookingId, error: dbErr.message });
                    }

                    return res.json({
                        sessionId: mockSessionId,
                        url: '/booking-success?session_id=' + mockSessionId,
                        devMode: true,
                        message: 'Development mode - payments disabled.'
                    });
                }

                const booking = await new Promise((resolve, reject) => {
                    db().get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!booking) {
                    return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
                }

                const accommodationConfig = accommodations.getById(booking.accommodation);
                const securityDepositAmount = accommodationConfig?.securityDeposit || 300;
                const hasSecurityDeposit = securityDepositAmount > 0;

                const cleaningFee = 75;
                const nights = Math.ceil(
                    (new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)
                );
                let extraGuestFee = 0;
                if (accommodationConfig?.extraGuestFee && booking.guests > 2) {
                    extraGuestFee = (booking.guests - 2) * accommodationConfig.extraGuestFee * nights;
                }
                // Pet fee from booking notes or detect from accommodation config
                const hasPets = booking.notes && /pet/i.test(booking.notes);
                const petFee = (accommodationConfig?.petFee && hasPets) ? accommodationConfig.petFee : 0;
                const nightlyTotal = booking.total_price - cleaningFee - extraGuestFee - petFee;

                const lineItems = [
                    {
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: `Lakeside Retreat - ${booking.accommodation}`,
                                description: `${booking.check_in} to ${booking.check_out} (${booking.guests} guests) (GST inclusive)`
                            },
                            unit_amount: Math.round(nightlyTotal * 100)
                        },
                        quantity: 1
                    },
                    {
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: 'Cleaning Fee',
                                description: 'One-time cleaning fee (GST inclusive)'
                            },
                            unit_amount: Math.round(cleaningFee * 100)
                        },
                        quantity: 1
                    }
                ];

                if (extraGuestFee > 0) {
                    lineItems.push({
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: 'Extra Guest Fee',
                                description: `${booking.guests - 2} extra guest(s) × ${nights} nights (GST inclusive)`
                            },
                            unit_amount: Math.round(extraGuestFee * 100)
                        },
                        quantity: 1
                    });
                }

                if (petFee > 0) {
                    lineItems.push({
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: 'Pet Fee',
                                description: 'Flat pet fee per stay (GST inclusive)'
                            },
                            unit_amount: Math.round(petFee * 100)
                        },
                        quantity: 1
                    });
                }

                if (hasSecurityDeposit) {
                    lineItems.push({
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: 'Security Deposit (Authorization Hold)',
                                description: 'Refundable security deposit - will be released automatically 48 hours after checkout (GST inclusive)'
                            },
                            unit_amount: Math.round(securityDepositAmount * 100)
                        },
                        quantity: 1
                    });
                }

                const sessionConfig = {
                    // payment_method_types intentionally omitted — Stripe Checkout uses
                    // automatic payment methods by default (card, Apple Pay, Google Pay, Link, etc.)
                    // Configure available methods in Stripe Dashboard > Settings > Payment methods
                    // Note: Apple Pay requires domain verification in Stripe Dashboard
                    mode: 'payment',
                    expires_at: Math.floor(Date.now() / 1000) + (30 * 60),
                    customer_email: booking.guest_email,
                    metadata: {
                        bookingId: booking.id,
                        hasSecurityDeposit: hasSecurityDeposit.toString(),
                        guest_name: booking.guest_name,
                        guest_email: booking.guest_email,
                        accommodation: booking.accommodation,
                        check_in: booking.check_in,
                        check_out: booking.check_out,
                        guests: String(booking.guests)
                    },
                    line_items: lineItems,
                    success_url: `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}/booking-cancelled`
                };

                if (hasSecurityDeposit) {
                    sessionConfig.payment_intent_data = {
                        capture_method: 'manual',
                        metadata: {
                            bookingId: booking.id,
                            booking_amount: Math.round(booking.total_price * 100),
                            security_deposit_amount: Math.round(securityDepositAmount * 100)
                        }
                    };
                }

                const idempotencyKey = `booking-${bookingId}`;
                const session = await stripe.checkout.sessions.create(sessionConfig, {
                    idempotencyKey
                });

                // Store Stripe session ID on the booking. If this fails, the webhook
                // can still match via metadata.bookingId, so we log but don't block.
                try {
                    await new Promise((resolve, reject) => {
                        db().run('UPDATE bookings SET stripe_session_id = ? WHERE id = ?',
                            [session.id, bookingId], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                    });
                } catch (dbErr) {
                    logger.error('[CRITICAL] Stripe session created but failed to store session ID in DB', {
                        stripeSessionId: session.id,
                        bookingId,
                        error: dbErr.message || String(dbErr)
                    });
                    // Continue anyway -- the session is valid and webhook can recover via metadata
                }

                res.json({ sessionId: session.id, url: session.url });

            } catch (error) {
                logger.error('Payment session creation error:', { error: error?.message, type: error?.type });

                if (error.type === 'StripeCardError') {
                    return sendError(res, 400, ERROR_CODES.PAYMENT_ERROR, 'Your card was declined.');
                } else if (error.type === 'StripeRateLimitError') {
                    return sendError(res, 429, ERROR_CODES.PAYMENT_ERROR, 'Too many requests. Please try again.');
                } else if (error.type === 'StripeInvalidRequestError') {
                    return sendError(res, 400, ERROR_CODES.PAYMENT_ERROR, 'Invalid payment request.');
                } else if (error.type === 'StripeAPIError') {
                    return sendError(res, 502, ERROR_CODES.PAYMENT_ERROR, 'Payment service temporarily unavailable.');
                } else if (error.type === 'StripeConnectionError') {
                    return sendError(res, 503, ERROR_CODES.PAYMENT_ERROR, 'Unable to connect to payment service.');
                } else if (error.type === 'StripeAuthenticationError') {
                    logger.error('❌ Stripe authentication error - check API keys');
                    return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Payment system configuration error.');
                } else {
                    return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Unable to process payment.');
                }
            }
        }
    );

    // --- Get booking status ---
    router.get('/api/booking/:id', (req, res) => {
        const { id } = req.params;

        db().get('SELECT * FROM bookings WHERE id = ?', [id], (err, booking) => {
            if (err) {
                logger.error('Error fetching booking:', { error: err?.message });
                return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Failed to fetch booking');
            }

            if (!booking) {
                return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
            }

            res.json({
                success: true,
                booking: {
                    id: booking.id,
                    accommodation: booking.accommodation,
                    check_in: booking.check_in,
                    check_out: booking.check_out,
                    guests: booking.guests,
                    status: booking.status,
                    payment_status: booking.payment_status,
                    total_price: booking.total_price,
                    created_at: booking.created_at
                }
            });
        });
    });

    // Look up booking by Stripe session ID (for success page after redirect)
    router.get('/api/booking/by-session/:sessionId', async (req, res) => {
        try {
            const sessionId = req.params.sessionId;

            if (!sessionId || sessionId.length < 10) {
                return res.status(400).json({ success: false, error: 'Invalid session ID' });
            }

            const booking = await new Promise((resolve, reject) => {
                db().get(
                    'SELECT id, accommodation, check_in, check_out, guests, status, payment_status, total_price, guest_name FROM bookings WHERE stripe_session_id = ?',
                    [sessionId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!booking) {
                return res.status(404).json({ success: false, error: 'Booking not found for this session' });
            }

            res.json({
                success: true,
                booking: {
                    id: booking.id,
                    accommodation: booking.accommodation,
                    check_in: booking.check_in,
                    check_out: booking.check_out,
                    guests: booking.guests,
                    status: booking.status,
                    payment_status: booking.payment_status,
                    total_price: booking.total_price
                }
            });
        } catch (error) {
            logger.error('Session lookup error:', { error: error?.message });
            res.status(500).json({ success: false, error: 'Failed to look up booking' });
        }
    });

    // Verify booking payment status (for confirmation page)
    router.get('/api/booking/:id/payment-status', async (req, res) => {
        try {
            const bookingId = req.params.id;

            if (!bookingId || bookingId.length < 10) {
                return res.status(400).json({ success: false, error: 'Invalid booking ID' });
            }

            const booking = await new Promise((resolve, reject) => {
                db().get(
                    'SELECT id, status, payment_status, guest_name, accommodation, check_in, check_out, total_price FROM bookings WHERE id = ?',
                    [bookingId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!booking) {
                return res.status(404).json({ success: false, error: 'Booking not found' });
            }

            res.json({
                success: true,
                booking: {
                    id: booking.id,
                    status: booking.status,
                    payment_status: booking.payment_status,
                    guest_name: booking.guest_name,
                    accommodation: booking.accommodation,
                    check_in: booking.check_in,
                    check_out: booking.check_out,
                    total_price: booking.total_price
                }
            });
        } catch (error) {
            logger.error('Payment status check error:', { error: error?.message });
            res.status(500).json({ success: false, error: 'Failed to check payment status' });
        }
    });

    return router;
}

module.exports = createBookingRoutes;
