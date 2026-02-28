/**
 * Uplisting Service
 * 
 * Consolidated module for all Uplisting PMS integration:
 * - Availability checking
 * - Booking sync (create/update)
 * - Booking cancellation
 * - Webhook handling
 * - Dashboard data retrieval
 * - Pricing data retrieval
 * 
 * Previously scattered across: server.js, uplisting-dashboard-api.js,
 * uplisting-pricing-integration.js, and config/properties.js
 */

const { getPropertyId, getAccommodationName } = require('../config/properties');
const { sanitizeInput } = require('../middleware/auth');

const UPLISTING_API_BASE = 'https://connect.uplisting.io';

class UplistingService {
    /**
     * @param {Object} opts
     * @param {string} opts.apiKey - Uplisting API key (from env)
     * @param {Function} opts.getDb - Returns the database connection
     */
    constructor(opts = {}) {
        this.apiKey = opts.apiKey || process.env.UPLISTING_API_KEY;
        this.getDb = opts.getDb || (() => null);
    }

    /** Whether Uplisting integration is configured */
    get isConfigured() {
        return !!this.apiKey;
    }

    /** Base64-encoded API key for Basic auth */
    get authHeader() {
        return `Basic ${Buffer.from(this.apiKey).toString('base64')}`;
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
            const propertyId = getPropertyId(accommodation);
            if (!propertyId) {
                console.warn(`⚠️ No Uplisting property ID for ${accommodation}`);
                return true;
            }

            const url = `${UPLISTING_API_BASE}/properties/${propertyId}/availability?start_date=${checkIn}&end_date=${checkOut}`;
            console.log('🔍 Checking Uplisting availability:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            console.log('📡 Uplisting API response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Uplisting API error:', response.status, errorText);
                return true; // Fail open
            }

            const data = await response.json();
            console.log('📝 Uplisting availability data:', data);
            return data.available === true;

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

            const response = await fetch(`${UPLISTING_API_BASE}/bookings`, {
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
                const db = this.getDb();
                if (db) {
                    db.run(
                        'UPDATE bookings SET uplisting_id = ? WHERE id = ?',
                        [uplistingResponse.id, bookingData.id],
                        (err) => {
                            if (err) console.error('❌ Failed to update Uplisting ID:', err);
                        }
                    );
                }

                return uplistingResponse.id;
            } else {
                console.error('❌ Failed to sync booking to Uplisting:', response.status);
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
            const response = await fetch(`${UPLISTING_API_BASE}/bookings/${uplistingId}/cancel`, {
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
     * Handle an incoming Uplisting webhook event.
     * Upserts booking data into local database.
     */
    handleWebhook(parsedBody, res) {
        const { event, data } = parsedBody;

        if (event === 'booking.created' || event === 'booking.updated') {
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
                status: data.status === 'confirmed' ? 'confirmed' : 'pending',
                payment_status: data.payment_status || 'completed',
                notes: sanitizeInput(data.notes || 'Booking from Uplisting'),
                uplisting_id: data.id
            };

            const sql = `
                INSERT INTO bookings (
                    id, guest_name, guest_email, guest_phone, accommodation,
                    check_in, check_out, guests, total_price, status,
                    payment_status, notes, uplisting_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                    uplisting_id = EXCLUDED.uplisting_id
            `;

            const db = this.getDb();
            if (db) {
                db.run(sql, [
                    bookingData.id, bookingData.guest_name, bookingData.guest_email,
                    bookingData.guest_phone, bookingData.accommodation,
                    bookingData.check_in, bookingData.check_out, bookingData.guests,
                    bookingData.total_price, bookingData.status,
                    bookingData.payment_status, bookingData.notes, bookingData.uplisting_id
                ], (err) => {
                    if (err) {
                        console.error('Failed to sync Uplisting booking:', err.message);
                    } else {
                        console.log('Uplisting booking synced:', data.id);
                    }
                });
            }
        }

        res.json({ received: true });
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
            const propertiesResponse = await fetch(`${UPLISTING_API_BASE}/properties`, {
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
                const bookingsResponse = await fetch(`${UPLISTING_API_BASE}/bookings?per_page=100`, {
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
                            const resp = await fetch(
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
    // PRICING DATA
    // (Previously in uplisting-pricing-integration.js)
    // ==========================================

    /**
     * Fetch pricing details (fees, taxes, discounts) from Uplisting.
     * Note: Uplisting doesn't expose nightly rates via API.
     */
    async getPricingData() {
        if (!this.isConfigured) return null;

        try {
            const response = await fetch(`${UPLISTING_API_BASE}/properties?include=fees,taxes,discounts`, {
                headers: { 'Authorization': this.authHeader, 'Content-Type': 'application/json' }
            });

            if (!response.ok) throw new Error(`API request failed: ${response.status}`);

            const data = await response.json();
            const properties = {};

            (data.data || []).forEach(property => {
                properties[property.id] = {
                    id: property.id,
                    name: property.attributes.name,
                    currency: property.attributes.currency,
                    maximum_capacity: property.attributes.maximum_capacity,
                    fees: {},
                    taxes: {},
                    discounts: {}
                };
            });

            if (data.included) {
                data.included.forEach(item => {
                    const propertyId = item.id.split('-')[0];
                    if (!properties[propertyId]) return;

                    const attrs = item.attributes;
                    if (item.type === 'property_fees') {
                        properties[propertyId].fees[attrs.label] = {
                            name: attrs.name, amount: attrs.amount,
                            enabled: attrs.enabled, guests_included: attrs.guests_included
                        };
                    } else if (item.type === 'property_taxes') {
                        properties[propertyId].taxes[attrs.label] = {
                            name: attrs.name, type: attrs.type,
                            per: attrs.per, amount: attrs.amount
                        };
                    } else if (item.type === 'property_discounts') {
                        properties[propertyId].discounts[attrs.label] = {
                            name: attrs.name, type: attrs.type,
                            days: attrs.days, amount: attrs.amount
                        };
                    }
                });
            }

            return properties;

        } catch (error) {
            console.error('❌ Failed to get Uplisting pricing:', error.message);
            return null;
        }
    }
}

module.exports = UplistingService;
