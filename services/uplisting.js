/**
 * Uplisting Service
 * 
 * Consolidated module for all Uplisting PMS integration:
 * - Availability checking
 * - Booking sync (create/update)
 * - Booking cancellation
 * - Webhook handling
 * - Dashboard data retrieval
 * - Calendar reconciliation
 * 
 * Previously scattered across: server.js, uplisting-dashboard-api.js,
 * uplisting-pricing-integration.js, and config/properties.js
 */

const crypto = require('crypto');
const { getPropertyId, getAccommodationName, PROPERTY_IDS } = require('../config/properties');
const { sanitizeInput } = require('../middleware/auth');

const UPLISTING_API_BASE = 'https://connect.uplisting.io';

class UplistingService {
    /**
     * @param {Object} opts
     * @param {string} opts.apiKey - Uplisting API key (from env)
     * @param {Function} opts.getDb - Returns the database connection
     * @param {Object} [opts.emailNotifications] - Email notification service (optional)
     */
    constructor(opts = {}) {
        this.apiKey = opts.apiKey || process.env.UPLISTING_API_KEY;
        this.webhookSecret = opts.webhookSecret || process.env.UPLISTING_WEBHOOK_SECRET;
        this.getDb = opts.getDb || (() => null);
        this.emailNotifications = opts.emailNotifications || null;
    }

    /** Whether Uplisting integration is configured */
    get isConfigured() {
        return !!this.apiKey;
    }

    /** Base64-encoded API key for Basic auth */
    get authHeader() {
        return `Basic ${Buffer.from(this.apiKey).toString('base64')}`;
    }

    /**
     * Fetch with exponential backoff retry for transient failures.
     */
    async fetchWithRetry(url, options, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeout);

                // Don't retry client errors (4xx) except 429
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    return response;
                }

                // Retry on server errors (5xx) and rate limiting (429)
                if (response.ok || attempt === maxRetries) {
                    return response;
                }

                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                console.warn(`⚠️ Uplisting API returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
            } catch (err) {
                clearTimeout(timeout);
                if (attempt === maxRetries) throw err;
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                console.warn(`⚠️ Uplisting API network error, retrying in ${delay}ms: ${err.message}`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    // ==========================================
    // AVAILABILITY
    // ==========================================

    /**
     * Check availability via Uplisting API for a specific accommodation.
     * Fails open (returns true) if API is unavailable.
     */
    async checkAvailability(accommodation, checkIn, checkOut) {
        if (!this.isConfigured) {
            console.warn('⚠️ Uplisting API key not configured, using local availability only');
            return true;
        }

        try {
            // Use the proven bookings-based approach to check availability
            // The /availability endpoint returns calendar data, not a simple boolean
            const blockedDates = await this.fetchBlockedDatesFromUplisting(accommodation);

            // Check if any requested date falls on a blocked date
            const start = new Date(checkIn);
            const end = new Date(checkOut);
            const blockedSet = new Set(blockedDates);

            for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                if (blockedSet.has(dateStr)) {
                    console.log(`📅 Date ${dateStr} is blocked on Uplisting for ${accommodation}`);
                    return false;
                }
            }

            console.log(`✅ All dates available on Uplisting for ${accommodation}: ${checkIn} to ${checkOut}`);
            return true;

        } catch (error) {
            console.error('❌ Uplisting availability check failed:', error);
            return true; // Fail open
        }
    }

    // ==========================================
    // BOOKING SYNC
    // ==========================================

    /**
     * Sync a booking to Uplisting (create on their side).
     * Updates local DB with the Uplisting booking ID on success.
     */
    async syncBooking(bookingData) {
        if (!this.isConfigured) {
            console.warn('⚠️ Uplisting not configured, booking not synced');
            return null;
        }

        try {
            const propertyId = getPropertyId(bookingData.accommodation);
            if (!propertyId) {
                console.warn(`⚠️ No Uplisting property ID for ${bookingData.accommodation}`);
                return null;
            }

            const uplistingBooking = {
                property_id: propertyId,
                guest: {
                    first_name: bookingData.guest_name.split(' ')[0],
                    last_name: bookingData.guest_name.split(' ').slice(1).join(' ') || '',
                    email: bookingData.guest_email,
                    phone: bookingData.guest_phone || ''
                },
                check_in: bookingData.check_in,
                check_out: bookingData.check_out,
                guests: bookingData.guests,
                total_amount: bookingData.total_price,
                currency: 'NZD',
                source: 'lakeside-retreat-website',
                notes: bookingData.notes || ''
            };

            const response = await this.fetchWithRetry(`${UPLISTING_API_BASE}/bookings`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(uplistingBooking)
            });

            if (response.ok) {
                const uplistingResponse = await response.json();
                console.log('✅ Booking synced to Uplisting:', uplistingResponse.id);

                // Update local booking with Uplisting ID
                try {
                    const database = require('../database');
                    await database.run(
                        'UPDATE bookings SET uplisting_id = ? WHERE id = ?',
                        [uplistingResponse.id, bookingData.id]
                    );
                } catch (dbErr) {
                    console.error('❌ Failed to update Uplisting ID:', dbErr.message);
                }

                return uplistingResponse.id;
            } else {
                const errorText = await response.text().catch(() => 'Unknown error');
                console.error('❌ Failed to sync booking to Uplisting:', response.status, errorText);
                // Track sync failure in database
                try {
                    const database = require('../database');
                    await database.run(
                        `UPDATE bookings SET notes = COALESCE(notes, '') || ? WHERE id = ?`,
                        [`\n[Uplisting sync failed at ${new Date().toISOString()}: ${response.status}]`, bookingData.id]
                    );
                } catch (dbErr) {
                    console.error('Failed to track sync failure:', dbErr.message);
                }
                return null;
            }

        } catch (error) {
            console.error('❌ Uplisting sync error:', error);
            return null;
        }
    }

    /**
     * Cancel a booking on Uplisting.
     */
    async cancelBooking(uplistingId) {
        if (!this.isConfigured || !uplistingId) return;

        try {
            const response = await this.fetchWithRetry(`${UPLISTING_API_BASE}/bookings/${uplistingId}/cancel`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                console.log('✅ Uplisting booking cancelled:', uplistingId);
            } else {
                console.error('❌ Failed to cancel Uplisting booking:', response.status);
            }
        } catch (error) {
            console.error('❌ Error cancelling Uplisting booking:', error);
        }
    }

    // ==========================================
    // WEBHOOK HANDLING
    // ==========================================

    /**
     * Verify the HMAC-SHA256 signature of an incoming Uplisting webhook.
     *
     * @param {Buffer} rawBody - The raw request body
     * @param {string} signature - The X-Uplisting-Signature header value
     * @returns {{ valid: boolean, reason?: string }} Verification result
     */
    verifyWebhookSignature(rawBody, signature) {
        if (!this.webhookSecret) {
            console.error('[SECURITY] UPLISTING_WEBHOOK_SECRET is not set — rejecting webhook (fail-closed)');
            return { valid: false, reason: 'no_secret_configured' };
        }

        if (!signature) {
            return { valid: false, reason: 'missing_signature' };
        }

        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(rawBody)
            .digest('hex');

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            return { valid: false, reason: 'signature_mismatch' };
        }

        return { valid: true };
    }

    /**
     * Handle an incoming Uplisting webhook event.
     * Upserts booking data into local database.
     */
    async handleWebhook(parsedBody) {
        const { event, data } = parsedBody;

        if (event === 'booking.created' || event === 'booking.updated') {
            // Extract booking channel (e.g. 'airbnb', 'booking_com') if provided by Uplisting
            const rawChannel = data.channel || data.source || data.platform || 'uplisting';
            const channel = sanitizeInput(String(rawChannel)).substring(0, 50);

            const bookingData = {
                id: `uplisting-${data.id}`,
                guest_name: sanitizeInput(`${data.guest.first_name} ${data.guest.last_name}`.trim()),
                guest_email: sanitizeInput(data.guest.email),
                guest_phone: sanitizeInput(data.guest.phone || ''),
                accommodation: getAccommodationName(data.property_id) || 'unknown',
                check_in: data.check_in,
                check_out: data.check_out,
                guests: data.guests,
                total_price: data.total_amount,
                status: ['confirmed', 'completed'].includes(data.status) ? 'confirmed' : (data.status === 'cancelled' || data.status === 'declined') ? 'cancelled' : 'pending',
                payment_status: data.payment_status === 'completed' ? 'completed' : 'pending',
                notes: sanitizeInput(data.notes || 'Booking from Uplisting'),
                uplisting_id: data.id,
                booking_source: channel
            };

            const sql = `
                INSERT INTO bookings (
                    id, guest_name, guest_email, guest_phone, accommodation,
                    check_in, check_out, guests, total_price, status,
                    payment_status, notes, uplisting_id, booking_source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    guest_name = EXCLUDED.guest_name,
                    guest_email = EXCLUDED.guest_email,
                    guest_phone = EXCLUDED.guest_phone,
                    accommodation = EXCLUDED.accommodation,
                    check_in = EXCLUDED.check_in,
                    check_out = EXCLUDED.check_out,
                    guests = EXCLUDED.guests,
                    total_price = EXCLUDED.total_price,
                    status = EXCLUDED.status,
                    payment_status = EXCLUDED.payment_status,
                    notes = EXCLUDED.notes,
                    uplisting_id = EXCLUDED.uplisting_id,
                    booking_source = EXCLUDED.booking_source,
                    updated_at = CURRENT_TIMESTAMP
            `;

            const database = require('../database');
            await database.run(sql, [
                bookingData.id, bookingData.guest_name, bookingData.guest_email,
                bookingData.guest_phone, bookingData.accommodation,
                bookingData.check_in, bookingData.check_out, bookingData.guests,
                bookingData.total_price, bookingData.status,
                bookingData.payment_status, bookingData.notes, bookingData.uplisting_id,
                bookingData.booking_source
            ]);
            console.log('Uplisting booking synced:', data.id);
            console.log(`New external booking from ${channel}: ${bookingData.guest_name} at ${bookingData.accommodation} (${bookingData.check_in} to ${bookingData.check_out})`);
            if (this.emailNotifications) {
                try {
                    this.emailNotifications.sendSystemAlert('New External Booking',
                        `New booking from ${channel}: ${bookingData.guest_name} at ${bookingData.accommodation} (${bookingData.check_in} to ${bookingData.check_out})`
                    );
                } catch (emailErr) {
                    console.error('Failed to send admin notification for external booking:', emailErr.message);
                }
            }
            return { received: true };
        } else if (event === 'booking.cancelled' || event === 'booking.deleted') {
            const bookingId = `uplisting-${data.id}`;
            const database = require('../database');
            await database.run(
                `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [bookingId]
            );
            console.log('Uplisting booking cancelled:', data.id);
            return { received: true };
        } else {
            return { received: true };
        }
    }

    // ==========================================
    // DASHBOARD DATA
    // (Previously in uplisting-dashboard-api.js)
    // ==========================================

    /**
     * Fetch dashboard summary: properties, bookings, revenue.
     */
    async getDashboardData() {
        if (!this.isConfigured) {
            return { success: false, error: 'Uplisting not configured' };
        }

        try {
            // Get properties
            const propertiesResponse = await this.fetchWithRetry(`${UPLISTING_API_BASE}/properties`, {
                headers: { 'Authorization': this.authHeader, 'Content-Type': 'application/json' }
            });

            if (!propertiesResponse.ok) {
                throw new Error(`Properties API failed: ${propertiesResponse.status}`);
            }

            const propertiesData = await propertiesResponse.json();
            const totalProperties = propertiesData.data ? propertiesData.data.length : 0;

            // Try to get bookings
            const bookingData = { total_bookings: 0, total_revenue: 0, bookings: [] };

            try {
                const bookingsResponse = await this.fetchWithRetry(`${UPLISTING_API_BASE}/bookings?per_page=100`, {
                    headers: { 'Authorization': this.authHeader, 'Content-Type': 'application/json' }
                });

                if (bookingsResponse.ok) {
                    const bookingsResult = await bookingsResponse.json();
                    if (bookingsResult.data && Array.isArray(bookingsResult.data)) {
                        bookingData.bookings = bookingsResult.data;
                        bookingData.total_bookings = bookingsResult.data.length;
                        bookingData.total_revenue = bookingsResult.data.reduce((sum, b) => {
                            const amount = b.attributes?.total_amount || b.attributes?.amount || 0;
                            return sum + (parseFloat(amount) || 0);
                        }, 0);
                    }
                } else if (bookingsResponse.status !== 429) {
                    // Try per-property bookings as fallback
                    for (const property of (propertiesData.data || []).slice(0, 2)) {
                        try {
                            const resp = await this.fetchWithRetry(
                                `${UPLISTING_API_BASE}/properties/${property.id}/bookings?per_page=50`,
                                { headers: { 'Authorization': this.authHeader, 'Content-Type': 'application/json' } }
                            );
                            if (resp.ok) {
                                const propBookings = await resp.json();
                                if (propBookings.data && Array.isArray(propBookings.data)) {
                                    bookingData.bookings.push(...propBookings.data);
                                    bookingData.total_bookings += propBookings.data.length;
                                    bookingData.total_revenue += propBookings.data.reduce((sum, b) => {
                                        return sum + (parseFloat(b.attributes?.total_amount || 0) || 0);
                                    }, 0);
                                }
                            }
                            await new Promise(r => setTimeout(r, 500)); // Rate limit delay
                        } catch (e) {
                            console.log(`Could not fetch bookings for property ${property.id}:`, e.message);
                        }
                    }
                }
            } catch (e) {
                console.log('📊 Could not fetch Uplisting bookings:', e.message);
            }

            return {
                success: true,
                total_properties: totalProperties,
                properties: (propertiesData.data || []).map(prop => ({
                    id: prop.id,
                    name: prop.attributes?.name || 'Unknown',
                    bedrooms: prop.attributes?.bedrooms || 0,
                    max_capacity: prop.attributes?.maximum_capacity || 0,
                    currency: prop.attributes?.currency || 'NZD'
                })),
                total_bookings: bookingData.total_bookings,
                total_revenue: bookingData.total_revenue,
                bookings: bookingData.bookings,
                message: `Connected - ${totalProperties} properties, ${bookingData.total_bookings} bookings`
            };

        } catch (error) {
            console.error('❌ Uplisting dashboard error:', error);
            return { success: false, error: error.message, total_properties: 0, properties: [] };
        }
    }

    // ==========================================
    // CALENDAR RECONCILIATION
    // ==========================================

    /**
     * Fetch bookings from Uplisting for a specific property within a date range.
     * @param {string} propertyId - Uplisting property ID
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Array} Array of booking objects from Uplisting, or empty array on failure
     */
    async fetchBookingsForProperty(propertyId, startDate, endDate) {
        try {
            const url = `${UPLISTING_API_BASE}/properties/${propertyId}/bookings?start_date=${startDate}&end_date=${endDate}&per_page=100`;
            const response = await this.fetchWithRetry(url, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.error(`❌ Failed to fetch bookings for property ${propertyId}: ${response.status}`);
                return [];
            }

            const result = await response.json();
            return (result.data && Array.isArray(result.data)) ? result.data : [];
        } catch (error) {
            console.error(`❌ Error fetching bookings for property ${propertyId}:`, error.message);
            return [];
        }
    }

    /**
     * Fetch blocked/unavailable dates from Uplisting for a specific accommodation.
     * Returns an array of date strings (YYYY-MM-DD) that are blocked.
     * @param {string} accommodation - Internal accommodation identifier
     * @returns {string[]} Array of blocked date strings
     */
    async fetchBlockedDatesFromUplisting(accommodation) {
        if (!this.isConfigured) return [];

        try {
            const propertyId = getPropertyId(accommodation);
            if (!propertyId) return [];

            const today = new Date();
            const endDate = new Date(today);
            endDate.setDate(endDate.getDate() + 365);

            const startStr = today.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];

            const bookings = await this.fetchBookingsForProperty(propertyId, startStr, endStr);

            const blockedDates = [];
            for (const booking of bookings) {
                const attrs = booking.attributes || booking;
                const status = attrs.status || attrs.state;
                if (status === 'cancelled' || status === 'declined') continue;

                const checkIn = attrs.check_in || attrs.checkin;
                const checkOut = attrs.check_out || attrs.checkout;
                if (!checkIn || !checkOut) continue;

                const start = new Date(checkIn);
                const end = new Date(checkOut);
                for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
                    blockedDates.push(d.toISOString().split('T')[0]);
                }
            }

            return blockedDates;
        } catch (error) {
            console.error(`❌ Error fetching Uplisting blocked dates for ${accommodation}:`, error.message);
            return [];
        }
    }

    /**
     * Reconcile calendar by fetching bookings from Uplisting for all properties
     * and inserting any missing bookings into the local database.
     * Safe to run repeatedly (idempotent).
     */
    async reconcileCalendar() {
        if (!this.isConfigured) return;

        try {
            const allMappings = { ...PROPERTY_IDS };
            const propertyEntries = Object.entries(allMappings).filter(([, id]) => !!id);

            if (propertyEntries.length === 0) return;

            const today = new Date();
            const endDate = new Date(today);
            endDate.setDate(endDate.getDate() + 365);
            const startStr = today.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];

            let newBookingsCount = 0;
            const database = require('../database');

            for (const [accommodation, propertyId] of propertyEntries) {
                const bookings = await this.fetchBookingsForProperty(propertyId, startStr, endStr);

                for (const booking of bookings) {
                    const attrs = booking.attributes || booking;
                    const uplistingId = booking.id || attrs.id;
                    if (!uplistingId) continue;

                    // Check if this booking already exists in local DB
                    const existing = await database.get(
                        'SELECT id FROM bookings WHERE uplisting_id = ?',
                        [String(uplistingId)]
                    );

                    if (existing) continue;

                    // Insert using the same pattern as handleWebhook / processWebhookBooking
                    const channel = attrs.channel || attrs.source || attrs.platform || 'uplisting';
                    const guestFirst = attrs.guest?.first_name || attrs.guest_first_name || 'Guest';
                    const guestLast = attrs.guest?.last_name || attrs.guest_last_name || '';
                    const guestEmail = attrs.guest?.email || attrs.guest_email || '';
                    const guestPhone = attrs.guest?.phone || attrs.guest_phone || '';
                    const status = attrs.status || attrs.state || 'confirmed';

                    const bookingData = {
                        id: `uplisting-${uplistingId}`,
                        guest_name: sanitizeInput(`${guestFirst} ${guestLast}`.trim()),
                        guest_email: sanitizeInput(guestEmail),
                        guest_phone: sanitizeInput(guestPhone),
                        accommodation,
                        check_in: attrs.check_in || attrs.checkin,
                        check_out: attrs.check_out || attrs.checkout,
                        guests: attrs.guests || attrs.number_of_guests || 1,
                        total_price: attrs.total_amount || attrs.amount || 0,
                        status: ['confirmed', 'completed'].includes(status) ? 'confirmed' : (status === 'cancelled' || status === 'declined') ? 'cancelled' : 'pending',
                        payment_status: attrs.payment_status === 'completed' ? 'completed' : 'pending',
                        notes: sanitizeInput(attrs.notes || 'Booking from Uplisting (calendar sync)'),
                        uplisting_id: String(uplistingId),
                        booking_source: channel
                    };

                    const sql = `
                        INSERT INTO bookings (
                            id, guest_name, guest_email, guest_phone, accommodation,
                            check_in, check_out, guests, total_price, status,
                            payment_status, notes, uplisting_id, booking_source, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT (id) DO NOTHING
                    `;

                    await database.run(sql, [
                        bookingData.id, bookingData.guest_name, bookingData.guest_email,
                        bookingData.guest_phone, bookingData.accommodation,
                        bookingData.check_in, bookingData.check_out, bookingData.guests,
                        bookingData.total_price, bookingData.status,
                        bookingData.payment_status, bookingData.notes, bookingData.uplisting_id,
                        bookingData.booking_source
                    ]);

                    newBookingsCount++;
                }

                // Rate limit delay between property fetches
                await new Promise(r => setTimeout(r, 500));
            }

            if (newBookingsCount > 0) {
                console.log(`[CALENDAR SYNC] Reconciled ${newBookingsCount} new bookings from Uplisting`);
            } else {
                console.log('[CALENDAR SYNC] Reconciled 0 new bookings from Uplisting');
            }
        } catch (error) {
            console.error('❌ Calendar reconciliation error:', error.message);
        }
    }
}

module.exports = UplistingService;
