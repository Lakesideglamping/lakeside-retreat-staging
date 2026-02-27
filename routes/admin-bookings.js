/**
 * Admin Booking Management Routes
 * 
 * All admin endpoints for managing bookings:
 * - GET    /api/admin/bookings — list/search/filter bookings
 * - GET    /api/admin/bookings/export — export bookings CSV
 * - GET    /api/admin/booking/:id — booking detail
 * - PUT    /api/admin/booking/:id/status — update booking status
 * - DELETE /api/admin/booking/:id — delete booking
 * - GET    /api/admin/stats — dashboard stats
 * - GET    /api/admin/booking-stats — detailed booking stats
 * - POST   /api/admin/bookings — manual booking creation
 * - GET    /api/admin/uplisting-dashboard — Uplisting dashboard data
 * - GET    /api/admin/uplisting-booking/:id — Uplisting booking detail
 * - GET    /api/admin/stripe-payment/:sessionId — Stripe payment detail
 * - POST   /api/admin/refund/:bookingId — process refund
 * - POST   /api/admin/retry-sync/:bookingId — retry Uplisting sync
 * - POST   /api/admin/claim-deposit/:bookingId — claim security deposit
 * - POST   /api/admin/release-deposit/:bookingId — release security deposit
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const { verifyAdmin, sendError, sendSuccess, sanitizeInput, ERROR_CODES } = require('../middleware/auth');

/**
 * @param {Object} deps
 * @param {Function} deps.db - Returns database connection
 * @param {Object} deps.stripe - Stripe instance (or null)
 * @param {boolean} deps.DEV_MODE
 * @param {Function} deps.syncBookingToUplisting
 * @param {Function} deps.cancelUplistingBooking
 * @param {Function} deps.sendBookingConfirmation
 * @param {Function} deps.scheduleDepositRelease
 * @param {Object} deps.database - Database abstraction layer
 */
function createAdminBookingRoutes(deps) {
    const { db, stripe, DEV_MODE, syncBookingToUplisting, cancelUplistingBooking,
             sendBookingConfirmation, scheduleDepositRelease, database } = deps;

// Get all bookings (admin only) - Enhanced with search, filters, and Stripe/Uplisting status
router.get('/api/admin/bookings', verifyAdmin, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;
    const accommodation = req.query.accommodation;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    
    let sql = `
        SELECT id, guest_name, guest_email, guest_phone, accommodation,
               check_in, check_out, guests, total_price, status,
               payment_status, created_at, stripe_payment_id, stripe_session_id,
               uplisting_id, updated_at
        FROM bookings
    `;
    
    let params = [];
    let conditions = [];
    
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    
    if (search) {
        conditions.push('(guest_name LIKE ? OR guest_email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }
    
    if (accommodation) {
        conditions.push('accommodation LIKE ?');
        params.push(`%${accommodation}%`);
    }
    
    if (dateFrom) {
        conditions.push('check_in >= ?');
        params.push(dateFrom);
    }
    
    if (dateTo) {
        conditions.push('check_out <= ?');
        params.push(dateTo);
    }
    
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    db().all(sql, params, (err, rows) => {
        if (err) {
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        // Get total count with same filters
        let countSql = 'SELECT COUNT(*) as total FROM bookings';
        let countParams = [];
        let countConditions = [];
        
        if (status) {
            countConditions.push('status = ?');
            countParams.push(status);
        }
        
        if (search) {
            countConditions.push('(guest_name LIKE ? OR guest_email LIKE ?)');
            countParams.push(`%${search}%`, `%${search}%`);
        }
        
        if (accommodation) {
            countConditions.push('accommodation LIKE ?');
            countParams.push(`%${accommodation}%`);
        }
        
        if (dateFrom) {
            countConditions.push('check_in >= ?');
            countParams.push(dateFrom);
        }
        
        if (dateTo) {
            countConditions.push('check_out <= ?');
            countParams.push(dateTo);
        }
        
        if (countConditions.length > 0) {
            countSql += ' WHERE ' + countConditions.join(' AND ');
        }
        
        db().get(countSql, countParams, (err, countRow) => {
            if (err) {
                return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
            }
            
            res.json({
                success: true,
                bookings: rows,
                pagination: {
                    total: countRow.total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(countRow.total / limit)
                }
            });
        });
    });
});

// Export bookings to CSV (admin only)
router.get('/api/admin/bookings/export', verifyAdmin, (req, res) => {
    const status = req.query.status;
    const search = req.query.search;
    const accommodation = req.query.accommodation;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    
    let sql = `
        SELECT id, guest_name, guest_email, guest_phone, accommodation,
               check_in, check_out, guests, total_price, status,
               payment_status, created_at, stripe_payment_id, uplisting_id
        FROM bookings
    `;
    
    let params = [];
    let conditions = [];
    
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    
    if (search) {
        conditions.push('(guest_name LIKE ? OR guest_email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }
    
    if (accommodation) {
        conditions.push('accommodation LIKE ?');
        params.push(`%${accommodation}%`);
    }
    
    if (dateFrom) {
        conditions.push('check_in >= ?');
        params.push(dateFrom);
    }
    
    if (dateTo) {
        conditions.push('check_out <= ?');
        params.push(dateTo);
    }
    
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db().all(sql, params, (err, rows) => {
        if (err) {
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        // Generate CSV
        const headers = [
            'ID', 'Guest Name', 'Email', 'Phone', 'Accommodation',
            'Check-in', 'Check-out', 'Guests', 'Total Price', 'Status',
            'Payment Status', 'Created At', 'Stripe ID', 'Uplisting ID'
        ];
        
        const csvRows = [headers.join(',')];
        
        rows.forEach(row => {
            const values = [
                row.id,
                `"${(row.guest_name || '').replace(/"/g, '""')}"`,
                `"${(row.guest_email || '').replace(/"/g, '""')}"`,
                `"${(row.guest_phone || '').replace(/"/g, '""')}"`,
                `"${(row.accommodation || '').replace(/"/g, '""')}"`,
                row.check_in,
                row.check_out,
                row.guests,
                row.total_price,
                row.status,
                row.payment_status,
                row.created_at,
                row.stripe_payment_id || '',
                row.uplisting_id || ''
            ];
            csvRows.push(values.join(','));
        });
        
        const csv = csvRows.join('\n');
        const filename = `bookings-export-${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    });
});

// Get booking details (admin only)
router.get('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    const sql = `
        SELECT * FROM bookings WHERE id = ?
    `;
    
    db().get(sql, [bookingId], (err, row) => {
        if (err) {
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        if (!row) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        res.json({ success: true, booking: row });
    });
});

// Update booking status (admin only)
router.put('/api/admin/booking/:id/status', verifyAdmin, [
    body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']),
    body('notes').optional().isLength({ max: 500 }).escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Invalid data',
            details: errors.array()
        });
    }
    
    const bookingId = req.params.id;
    const { status, notes } = req.body;
    
    let sql = 'UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP';
    let params = [status];
    
    if (notes) {
        sql += ', notes = ?';
        params.push(sanitizeInput(notes));
    }
    
    sql += ' WHERE id = ?';
    params.push(bookingId);
    
    db().run(sql, params, function(err) {
        if (err) {
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        if (this.changes === 0) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        res.json({
            success: true,
            message: 'Booking status updated'
        });
    });
});

// Delete booking (admin only)
router.delete('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    db().run('DELETE FROM bookings WHERE id = ?', [bookingId], function(err) {
        if (err) {
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        if (this.changes === 0) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        res.json({
            success: true,
            message: 'Booking deleted'
        });
    });
});

// Get booking statistics (admin only)
router.get('/api/admin/stats', verifyAdmin, (req, res) => {
    // Combined into a single query (was 5 separate queries)
    // See EFFICIENCY_REPORT.md - Issue #2
    const sql = `
        SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
            COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
            COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
            COUNT(CASE WHEN DATE(created_at) = DATE('now') THEN 1 END) as today_bookings
        FROM bookings
    `;
    
    db().get(sql, (err, stats) => {
        if (err) {
            console.error('Stats query error:', err);
            return res.status(500).json({ success: false, error: 'Failed to load stats' });
        }
        
        res.json({
            success: true,
            stats: {
                total_bookings: stats.total_bookings || 0,
                pending_bookings: stats.pending_bookings || 0,
                confirmed_bookings: stats.confirmed_bookings || 0,
                total_revenue: stats.total_revenue || 0,
                today_bookings: stats.today_bookings || 0
            }
        });
    });
});

router.get('/api/admin/uplisting-dashboard', verifyAdmin, async (req, res) => {
    try {
        const uplistingData = await getUplistingDashboardData();
        res.json(uplistingData);
    } catch (error) {
        console.error('❌ Error fetching Uplisting dashboard data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch Uplisting data'
        });
    }
});

// Get Stripe payment details for a booking
router.get('/api/admin/stripe-payment/:sessionId', verifyAdmin, async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId || sessionId === 'null') {
            return res.json({ 
                success: false, 
                error: 'No Stripe session associated with this booking' 
            });
        }
        
        // Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent', 'customer']
        });
        
        // Get payment intent details if available
        let paymentDetails = null;
        if (session.payment_intent) {
            paymentDetails = await stripe.paymentIntents.retrieve(
                typeof session.payment_intent === 'string' 
                    ? session.payment_intent 
                    : session.payment_intent.id
            );
        }
        
        res.json({
            success: true,
            session: {
                id: session.id,
                status: session.payment_status,
                amount: session.amount_total / 100,
                currency: session.currency,
                customer_email: session.customer_email || session.customer_details?.email,
                created: new Date(session.created * 1000).toISOString(),
                payment_method_types: session.payment_method_types,
                url: session.url // Checkout URL if still valid
            },
            payment: paymentDetails ? {
                id: paymentDetails.id,
                status: paymentDetails.status,
                amount: paymentDetails.amount / 100,
                refunded: paymentDetails.amount_refunded > 0,
                refund_amount: paymentDetails.amount_refunded / 100,
                receipt_url: paymentDetails.charges?.data[0]?.receipt_url
            } : null
        });
        
    } catch (error) {
        console.error('❌ Error fetching Stripe details:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get Uplisting booking details
router.get('/api/admin/uplisting-booking/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        if (!process.env.UPLISTING_API_KEY) {
            return res.json({
                success: false,
                error: 'Uplisting not configured'
            });
        }
        
        if (!bookingId || bookingId === 'null') {
            return res.json({
                success: false,
                error: 'No Uplisting ID associated with this booking'
            });
        }
        
        const response = await fetch(`https://connect.uplisting.io/bookings/${bookingId}`, {
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.UPLISTING_API_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Uplisting API error: ${response.status}`);
        }
        
        const uplistingData = await response.json();
        
        res.json({
            success: true,
            booking: {
                id: uplistingData.id,
                status: uplistingData.status,
                property_name: uplistingData.property?.name,
                check_in: uplistingData.check_in,
                check_out: uplistingData.check_out,
                guest_name: `${uplistingData.guest?.first_name} ${uplistingData.guest?.last_name}`,
                guest_email: uplistingData.guest?.email,
                total_amount: uplistingData.total_amount,
                calendar_url: `https://app.uplisting.io/properties/${uplistingData.property_id}/calendar`,
                booking_url: `https://app.uplisting.io/bookings/${uplistingData.id}`
            }
        });
        
    } catch (error) {
        console.error('❌ Error fetching Uplisting details:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Process Stripe refund
router.post('/api/admin/refund/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, reason } = req.body;
        
        // Get booking from database
        db().get(
            'SELECT * FROM bookings WHERE id = ?',
            [bookingId],
            async (err, booking) => {
                if (err || !booking) {
                    return res.status(404).json({
                        success: false,
                        error: 'Booking not found'
                    });
                }
                
                if (!booking.stripe_payment_id) {
                    return res.status(400).json({
                        success: false,
                        error: 'No Stripe payment to refund'
                    });
                }
                
                try {
                    // Create refund in Stripe
                    const refund = await stripe.refunds.create({
                        payment_intent: booking.stripe_payment_id,
                        amount: amount ? Math.round(amount * 100) : undefined, // Partial refund if amount specified
                        reason: reason || 'requested_by_customer'
                    });
                    
                    // Update booking status
                    const newStatus = refund.amount === booking.total_price * 100 ? 'cancelled' : 'partially_refunded';
                    
                    db().run(
                        'UPDATE bookings SET status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [newStatus, 'refunded', bookingId],
                        (updateErr) => {
                            if (updateErr) {
                                console.error('❌ Failed to update booking after refund:', updateErr);
                            }
                        }
                    );
                    
                    // Cancel in Uplisting if full refund
                    if (booking.uplisting_id && refund.amount === booking.total_price * 100) {
                        await cancelUplistingBooking(booking.uplisting_id);
                    }
                    
                    res.json({
                        success: true,
                        refund: {
                            id: refund.id,
                            amount: refund.amount / 100,
                            status: refund.status,
                            reason: refund.reason
                        }
                    });
                    
                } catch (refundError) {
                    console.error('❌ Refund failed:', refundError);
                    res.status(500).json({
                        success: false,
                        error: refundError.message
                    });
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Refund error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Retry failed booking sync
router.post('/api/admin/retry-sync/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        db().get(
            'SELECT * FROM bookings WHERE id = ?',
            [bookingId],
            async (err, booking) => {
                if (err || !booking) {
                    return res.status(404).json({
                        success: false,
                        error: 'Booking not found'
                    });
                }
                
                // Retry Uplisting sync if not already synced
                if (!booking.uplisting_id && booking.payment_status === 'completed') {
                    await syncBookingToUplisting(booking);
                    
                    // Check if sync succeeded
                    db().get(
                        'SELECT uplisting_id FROM bookings WHERE id = ?',
                        [bookingId],
                        (err, updated) => {
                            if (!err && updated?.uplisting_id) {
                                res.json({
                                    success: true,
                                    message: 'Booking synced successfully',
                                    uplisting_id: updated.uplisting_id
                                });
                            } else {
                                res.json({
                                    success: false,
                                    error: 'Sync failed - check Uplisting configuration'
                                });
                            }
                        }
                    );
                } else {
                    res.json({
                        success: false,
                        error: booking.uplisting_id 
                            ? 'Booking already synced' 
                            : 'Payment not completed'
                    });
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Retry sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get booking statistics with payment status
router.get('/api/admin/booking-stats', verifyAdmin, (req, res) => {
    const stats = {};
    
    // Get overall stats
    db().get(
        `SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as paid_bookings,
            COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_payments,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
            COUNT(CASE WHEN uplisting_id IS NOT NULL THEN 1 END) as synced_bookings,
            SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as total_revenue
        FROM bookings`,
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            stats.overview = row;
            
            // Get recent bookings with sync status
            db().all(
                `SELECT 
                    id, guest_name, accommodation, check_in, total_price,
                    payment_status, status,
                    CASE WHEN stripe_session_id IS NOT NULL THEN 'Yes' ELSE 'No' END as stripe_connected,
                    CASE WHEN uplisting_id IS NOT NULL THEN 'Yes' ELSE 'No' END as uplisting_synced,
                    created_at
                FROM bookings 
                ORDER BY created_at DESC 
                LIMIT 10`,
                (err, rows) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    stats.recent_bookings = rows;
                    
                    res.json({
                        success: true,
                        stats
                    });
                }
            );
        }
    );
});

// SECURITY DEPOSIT ADMIN ENDPOINTS (Must be after verifyAdmin definition)
// Admin endpoint to manually claim security deposit
router.post('/api/admin/claim-deposit/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, reason } = req.body;
        
        if (!amount || !reason) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Amount and reason are required');
        }
        
        // Get booking details
        const booking = await new Promise((resolve, reject) => {
            db().get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!booking) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        if (!booking.security_deposit_intent_id) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'No security deposit found for this booking');
        }
        
        if (booking.security_deposit_status === 'released') {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Security deposit has already been released');
        }
        
        const claimAmountCents = Math.round(parseFloat(amount) * 100);
        const maxClaimCents = Math.round(booking.security_deposit_amount * 100);
        
        if (claimAmountCents > maxClaimCents) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Claim amount cannot exceed security deposit amount');
        }
        
        // Capture the claimed amount from the authorization hold
        await stripe.paymentIntents.capture(booking.security_deposit_intent_id, {
            amount_to_capture: claimAmountCents
        });
        
        // Update database with claim details
        const sql = `
            UPDATE bookings 
            SET security_deposit_status = 'claimed', 
                security_deposit_claimed_amount = ?,
                security_deposit_released_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        
        await new Promise((resolve, reject) => {
            db().run(sql, [parseFloat(amount), bookingId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        console.log(`✅ Security deposit claimed: $${amount} from booking ${bookingId}`);
        
        // Send notification email to admin
        await emailNotifications.sendSystemAlert('info', 
            `Security deposit claimed for ${booking.guest_name}`, 
            {
                'Booking ID': booking.id,
                'Guest': booking.guest_name,
                'Accommodation': booking.accommodation,
                'Claimed Amount': `$${amount}`,
                'Total Deposit': `$${booking.security_deposit_amount}`,
                'Reason': reason,
                'Claim Date': new Date().toLocaleString('en-NZ')
            }
        );
        
        res.json({
            success: true,
            message: 'Security deposit claimed successfully',
            claimedAmount: parseFloat(amount),
            totalDeposit: booking.security_deposit_amount,
            reason: reason
        });
        
    } catch (error) {
        console.error('❌ Security deposit claim error:', error);
        return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Failed to claim security deposit');
    }
});

// Admin endpoint to manually release security deposit
router.post('/api/admin/release-deposit/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // Get booking details
        const booking = await new Promise((resolve, reject) => {
            db().get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!booking) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        if (!booking.security_deposit_intent_id) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'No security deposit found for this booking');
        }
        
        if (booking.security_deposit_status === 'released') {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Security deposit has already been released');
        }
        
        // Cancel the authorization hold (releases the funds)
        await stripe.paymentIntents.cancel(booking.security_deposit_intent_id);
        
        // Update database
        const sql = `
            UPDATE bookings 
            SET security_deposit_status = 'released', 
                security_deposit_released_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        
        await new Promise((resolve, reject) => {
            db().run(sql, [bookingId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        console.log(`✅ Security deposit manually released for booking ${bookingId}`);
        
        // Send notification email
        await emailNotifications.sendSystemAlert('info', 
            `Security deposit manually released for ${booking.guest_name}`, 
            {
                'Booking ID': booking.id,
                'Guest': booking.guest_name,
                'Accommodation': booking.accommodation,
                'Deposit Amount': `$${booking.security_deposit_amount}`,
                'Release Date': new Date().toLocaleString('en-NZ'),
                'Released By': 'Admin (Manual)'
            }
        );
        
        res.json({
            success: true,
            message: 'Security deposit released successfully',
            amount: booking.security_deposit_amount
        });
        
    } catch (error) {
        console.error('❌ Security deposit release error:', error);
        return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Failed to release security deposit');
    }
});

router.post('/api/admin/bookings', verifyAdmin, async (req, res) => {
    try {
        const {
            guest_name,
            guest_email,
            guest_phone,
            accommodation,
            check_in,
            check_out,
            guests,
            total_price,
            payment_status,
            notes
        } = req.body;

        if (!guest_name || !guest_email || !accommodation || !check_in || !check_out) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: guest_name, guest_email, accommodation, check_in, check_out'
            });
        }

        const bookingId = uuidv4();
        const sql = `
            INSERT INTO bookings (
                id, guest_name, guest_email, guest_phone, accommodation,
                check_in, check_out, guests, total_price, status,
                payment_status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;

        db().run(sql, [
            bookingId,
            sanitizeInput(guest_name),
            sanitizeInput(guest_email),
            sanitizeInput(guest_phone || ''),
            accommodation,
            check_in,
            check_out,
            guests || 2,
            total_price || 0,
            'confirmed',
            payment_status || 'completed',
            sanitizeInput(notes || '')
        ], function(err) {
            if (err) {
                console.error('Error creating manual booking:', err);
                return res.status(500).json({ success: false, error: 'Failed to create booking' });
            }
            
            res.json({
                success: true,
                booking: {
                    id: bookingId,
                    guest_name,
                    guest_email,
                    accommodation,
                    check_in,
                    check_out,
                    guests: guests || 2,
                    total_price: total_price || 0,
                    status: 'confirmed',
                    payment_status: payment_status || 'completed'
                }
            });
        });
    } catch (error) {
        console.error('Error in manual booking creation:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});


    return router;
}

module.exports = createAdminBookingRoutes;
