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

const { sendError, sendSuccess, sanitizeInput, ERROR_CODES } = require('../middleware/auth');

const bookingLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { error: 'Too many booking attempts, please try again later' },
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
 * @param {Function} deps.checkAvailability - Availability check function
 * @param {Function} deps.executeDbOperation - DB operation wrapper
 * @param {Function} deps.sendBookingConfirmation - Email confirmation sender
 * @param {Object} deps.tracking - Booking tracking functions
 */
function createBookingRoutes(deps) {
    const { 
        db, stripe, DEV_MODE, bookingQueue, paymentQueue,
        checkAvailability, executeDbOperation,
        tracking: { trackBookingStart, trackBookingStep, trackBookingSuccess, trackBookingFailure }
    } = deps;

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

            db().all(sql, [accommodation], (err, rows) => {
                if (err) {
                    console.error('Error fetching blocked dates:', err);
                    return res.json({ success: true, blockedDates: [] });
                }

                const blockedDates = [];
                rows.forEach(booking => {
                    const start = new Date(booking.check_in);
                    const end = new Date(booking.check_out);
                    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
                        blockedDates.push(d.toISOString().split('T')[0]);
                    }
                });

                res.json({ success: true, blockedDates });
            });
        } catch (error) {
            console.error('Error in blocked-dates endpoint:', error);
            res.json({ success: true, blockedDates: [] });
        }
    });

    // --- Availability check ---
    router.post('/api/availability', async (req, res) => {
        const { accommodation, checkIn, checkOut, guests, propertyId } = req.body;

        if (!accommodation || !checkIn || !checkOut) {
            return res.status(400).json({ success: false, error: 'Missing required fields', available: false });
        }

        try {
            const sql = `
                SELECT COUNT(*) as count 
                FROM bookings 
                WHERE accommodation = ? 
                AND status IN ('confirmed', 'pending')
                AND (
                    (check_in <= ? AND check_out > ?) OR
                    (check_in < ? AND check_out >= ?) OR
                    (check_in >= ? AND check_out <= ?)
                )
            `;

            db().get(sql, [accommodation, checkIn, checkIn, checkOut, checkOut, checkIn, checkOut], (err, row) => {
                if (err) {
                    console.error('Error checking availability:', err);
                    return res.json({ success: true, available: true, source: 'dev-fallback' });
                }

                const isAvailable = row.count === 0;
                console.log(`📅 Availability check for ${accommodation}: ${checkIn} to ${checkOut} - ${isAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);

                res.json({
                    success: true,
                    available: isAvailable,
                    source: 'local-database'
                });
            });
        } catch (error) {
            console.error('Error in availability endpoint:', error);
            res.json({ success: true, available: true, source: 'dev-fallback' });
        }
    });

    // --- Legacy endpoints ---
    router.post('/api/process-booking', bookingLimiter, async (req, res) => {
        console.log('⚠️ Legacy endpoint /api/process-booking called - redirecting to /api/bookings');
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
        console.log('⚠️ Legacy endpoint /api/create-booking called - redirecting to /api/bookings');
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

                console.log('📝 Processing booking request for:', accommodation);
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

                trackBookingStep('availability_check', req.requestId, {
                    checkIn: sanitizedData.check_in,
                    checkOut: sanitizedData.check_out
                });

                const isAvailable = await checkAvailability(
                    sanitizedData.accommodation,
                    sanitizedData.check_in,
                    sanitizedData.check_out
                );

                if (!isAvailable) {
                    return sendError(res, 409, ERROR_CODES.DATES_NOT_AVAILABLE, 'Selected dates are not available');
                }

                const bookingId = uuidv4();

                const sql = `
                    INSERT INTO bookings (
                        id, guest_name, guest_email, guest_phone, 
                        accommodation, check_in, check_out, guests, 
                        total_price, status, payment_status, notes, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, CURRENT_TIMESTAMP)
                `;

                const booking = await executeDbOperation(
                    (database, params, callback) => {
                        database.run(sql, params, function(err) {
                            if (err) {
                                callback(err);
                            } else {
                                trackBookingStep('database_save', req.requestId, { bookingId });
                                callback(null, {
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
                                });
                            }
                        });
                    },
                    db(),
                    [
                        bookingId,
                        sanitizedData.guest_name, sanitizedData.guest_email,
                        sanitizedData.guest_phone, sanitizedData.accommodation,
                        sanitizedData.check_in, sanitizedData.check_out,
                        sanitizedData.guests, sanitizedData.total_price,
                        sanitizedData.notes || ''
                    ]
                );

                trackBookingSuccess(booking.id, req.requestId, booking.total_price);

                res.status(201).json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    message: 'Booking created successfully',
                    data: { booking }
                });

            } catch (error) {
                console.error('❌ Booking creation error:', error);
                trackBookingFailure(error, req.requestId, 'unknown');
                return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to create booking', error.message);
            }
        }
    );

    // --- Payment session ---
    router.post('/api/payments/create-session',
        paymentQueue.middleware({ queueName: 'payment', priority: 'high' }),
        async (req, res) => {
            try {
                const { bookingId } = req.body;

                if (!bookingId) {
                    return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Booking ID is required');
                }

                if (DEV_MODE || !stripe) {
                    console.log('⚠️ DEV_MODE: Returning mock payment session for booking', bookingId);
                    return res.json({
                        sessionId: 'dev_mock_session_' + bookingId,
                        url: '/booking-success?session_id=dev_mock_session_' + bookingId,
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

                const securityDepositAmount = booking.security_deposit_amount || 350.00;
                const hasSecurityDeposit = securityDepositAmount > 0;

                const lineItems = [
                    {
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: `Lakeside Retreat - ${booking.accommodation}`,
                                description: `${booking.check_in} to ${booking.check_out} (${booking.guests} guests)`
                            },
                            unit_amount: Math.round(booking.total_price * 100)
                        },
                        quantity: 1
                    }
                ];

                if (hasSecurityDeposit) {
                    lineItems.push({
                        price_data: {
                            currency: 'nzd',
                            product_data: {
                                name: 'Security Deposit (Authorization Hold)',
                                description: 'Refundable security deposit - will be released automatically 48 hours after checkout'
                            },
                            unit_amount: Math.round(securityDepositAmount * 100)
                        },
                        quantity: 1
                    });
                }

                const sessionConfig = {
                    payment_method_types: ['card'],
                    mode: 'payment',
                    customer_email: booking.guest_email,
                    metadata: {
                        bookingId: booking.id,
                        hasSecurityDeposit: hasSecurityDeposit.toString()
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

                const session = await stripe.checkout.sessions.create(sessionConfig);

                await new Promise((resolve, reject) => {
                    db().run('UPDATE bookings SET stripe_session_id = ? WHERE id = ?',
                        [session.id, bookingId], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                });

                res.json({ sessionId: session.id, url: session.url });

            } catch (error) {
                console.error('❌ Payment session creation error:', error);

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
                    console.error('❌ Stripe authentication error - check API keys');
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
                console.error('Error fetching booking:', err);
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

    return router;
}

module.exports = createBookingRoutes;
