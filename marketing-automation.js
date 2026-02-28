const database = require('./database');

class MarketingAutomation {
    constructor(db, emailTransporter) {
        this.db = db;
        this.emailTransporter = emailTransporter;
        this.isRunning = false;
        this.abandonedCheckInterval = null;
        this.reviewRequestInterval = null;
    }

    // Initialize the marketing automation system
    async initialize() {
        console.log('📧 Marketing Automation: Initializing...');
        
        // Create necessary tables
        await this.createTables();
        
        // Start scheduled jobs (every 15 minutes for abandoned, daily for reviews)
        this.startScheduledJobs();
        
        console.log('📧 Marketing Automation: Ready');
    }

    // Create database tables for marketing features
    async createTables() {
        return new Promise((resolve, reject) => {
            // Use PostgreSQL-compatible syntax if using PostgreSQL
            const isPostgres = database.isUsingPostgres();
            const idType = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            
            // Create abandoned_checkout_reminders table to track sent reminders
            const createRemindersTable = `
                CREATE TABLE IF NOT EXISTS abandoned_checkout_reminders (
                    id ${idType},
                    booking_id TEXT NOT NULL,
                    guest_email TEXT NOT NULL,
                    guest_name TEXT,
                    accommodation TEXT,
                    check_in TEXT,
                    check_out TEXT,
                    reminder_count INTEGER DEFAULT 0,
                    last_reminder_sent_at TEXT,
                    last_error TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(booking_id)
                )
            `;

            // Create review_requests table
            const createReviewRequestsTable = `
                CREATE TABLE IF NOT EXISTS review_requests (
                    id ${idType},
                    booking_id TEXT NOT NULL,
                    guest_email TEXT NOT NULL,
                    guest_name TEXT,
                    accommodation TEXT,
                    check_out TEXT,
                    request_count INTEGER DEFAULT 0,
                    last_request_sent_at TEXT,
                    last_error TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(booking_id)
                )
            `;

            // Create social_content_drafts table
            const createSocialDraftsTable = `
                CREATE TABLE IF NOT EXISTS social_content_drafts (
                    id ${idType},
                    platform TEXT NOT NULL,
                    source_type TEXT,
                    source_text TEXT,
                    accommodation TEXT,
                    generated_caption TEXT,
                    hashtags TEXT,
                    story_text TEXT,
                    status TEXT DEFAULT 'draft',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `;

            this.db.run(createRemindersTable, (err) => {
                if (err) {
                    console.error('Error creating reminders table:', err);
                    reject(err);
                    return;
                }
                console.log('   Abandoned checkout reminders table ready');
                
                this.db.run(createReviewRequestsTable, (err) => {
                    if (err) {
                        console.error('Error creating review requests table:', err);
                        reject(err);
                        return;
                    }
                    console.log('   Review requests table ready');
                    
                    this.db.run(createSocialDraftsTable, (err) => {
                        if (err) {
                            console.error('Error creating social drafts table:', err);
                            reject(err);
                            return;
                        }
                        console.log('   Social content drafts table ready');
                        resolve();
                    });
                });
            });
        });
    }

    // Start scheduled jobs
    startScheduledJobs() {
        // Check for abandoned checkouts every 15 minutes
        this.abandonedCheckInterval = setInterval(() => {
            this.processAbandonedCheckouts();
        }, 15 * 60 * 1000); // 15 minutes

        // Check for review requests daily at 10am (run every hour, check time)
        this.reviewRequestInterval = setInterval(() => {
            const hour = new Date().getHours();
            if (hour === 10) { // 10am
                this.processReviewRequests();
            }
        }, 60 * 60 * 1000); // 1 hour

        console.log('   Scheduled jobs started (abandoned: 15min, reviews: daily 10am)');
    }

    // Stop scheduled jobs
    stopScheduledJobs() {
        if (this.abandonedCheckInterval) {
            clearInterval(this.abandonedCheckInterval);
        }
        if (this.reviewRequestInterval) {
            clearInterval(this.reviewRequestInterval);
        }
    }

    // ==========================================
    // FEATURE 1: Abandoned Booking Follow-up
    // ==========================================

    async processAbandonedCheckouts() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            console.log('[Marketing] Checking for abandoned checkouts...');
            
            // Find bookings that:
            // - Have a stripe_session_id (checkout was started)
            // - payment_status is still 'pending'
            // - Created more than 2 hours ago
            // - Haven't been reminded more than 2 times
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            
            const abandonedBookings = await new Promise((resolve, reject) => {
                const sql = `
                    SELECT b.*, r.reminder_count, r.last_reminder_sent_at
                    FROM bookings b
                    LEFT JOIN abandoned_checkout_reminders r ON b.id = r.booking_id
                    WHERE b.stripe_session_id IS NOT NULL
                    AND b.payment_status = 'pending'
                    AND b.created_at < ?
                    AND (r.reminder_count IS NULL OR r.reminder_count < 2)
                    AND (r.last_reminder_sent_at IS NULL OR r.last_reminder_sent_at < ?)
                `;
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                
                this.db.all(sql, [twoHoursAgo, oneDayAgo], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            console.log(`[Marketing] Found ${abandonedBookings.length} abandoned checkouts`);

            for (const booking of abandonedBookings) {
                await this.sendAbandonedCheckoutReminder(booking);
            }
        } catch (error) {
            console.error('[Marketing] Error processing abandoned checkouts:', error);
        } finally {
            this.isRunning = false;
        }
    }

    async sendAbandonedCheckoutReminder(booking) {
        const reminderCount = (booking.reminder_count || 0) + 1;
        
        try {
            // Check if email is configured
            if (!this.emailTransporter || !process.env.EMAIL_USER) {
                // Store as draft if email not configured
                await this.storeReminderAsDraft(booking, reminderCount, 'Email not configured');
                return;
            }

            const subject = reminderCount === 1 
                ? `Complete your booking at Lakeside Retreat`
                : `Don't miss out - your Lakeside Retreat booking is waiting`;

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: booking.guest_email,
                subject: subject,
                html: this.generateAbandonedEmailHtml(booking, reminderCount)
            };

            await this.emailTransporter.sendMail(mailOptions);
            
            // Update reminder record
            await this.updateReminderRecord(booking.id, reminderCount, null);
            
            console.log(`[Marketing] Sent reminder #${reminderCount} to ${booking.guest_email}`);
        } catch (error) {
            console.error(`[Marketing] Failed to send reminder to ${booking.guest_email}:`, error.message);
            await this.updateReminderRecord(booking.id, reminderCount, error.message);
        }
    }

    generateAbandonedEmailHtml(booking, reminderCount) {
        const accommodationName = this.formatAccommodationName(booking.accommodation);
        const checkIn = new Date(booking.check_in).toLocaleDateString('en-NZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const checkOut = new Date(booking.check_out).toLocaleDateString('en-NZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background: #f9f9f9; }
                    .booking-details { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    .cta-button { display: inline-block; background: #2c5530; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                    .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Lakeside Retreat</h1>
                    </div>
                    <div class="content">
                        <p>Hi ${booking.guest_name || 'there'},</p>
                        
                        ${reminderCount === 1 ? `
                            <p>We noticed you started booking your stay at Lakeside Retreat but didn't complete the checkout. No worries - your booking details are still saved!</p>
                        ` : `
                            <p>Just a friendly reminder that your booking at Lakeside Retreat is still waiting for you. We'd hate for you to miss out on this special experience.</p>
                        `}
                        
                        <div class="booking-details">
                            <h3>Your Booking Details:</h3>
                            <p><strong>Accommodation:</strong> ${accommodationName}</p>
                            <p><strong>Check-in:</strong> ${checkIn}</p>
                            <p><strong>Check-out:</strong> ${checkOut}</p>
                            <p><strong>Guests:</strong> ${booking.guests}</p>
                            <p><strong>Total:</strong> $${booking.total_price} NZD</p>
                        </div>
                        
                        <p>Ready to complete your booking? Simply click the button below:</p>
                        
                        <center>
                            <a href="${process.env.PUBLIC_BASE_URL || 'https://lakesideretreat.co.nz'}/#book" class="cta-button">Complete My Booking</a>
                        </center>
                        
                        <p>If you have any questions or need help, just reply to this email - we're here to help!</p>
                        
                        <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                    </div>
                    <div class="footer">
                        <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                        <p><a href="${process.env.PUBLIC_BASE_URL || 'https://lakesideretreat.co.nz'}/unsubscribe">Unsubscribe</a> from booking reminders</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    async storeReminderAsDraft(booking, reminderCount, error) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO abandoned_checkout_reminders (booking_id, guest_email, guest_name, accommodation, check_in, check_out, reminder_count, last_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(booking_id) DO UPDATE SET
                    reminder_count = ?,
                    last_error = ?,
                    last_reminder_sent_at = CURRENT_TIMESTAMP
            `;
            this.db.run(sql, [
                booking.id, booking.guest_email, booking.guest_name, booking.accommodation,
                booking.check_in, booking.check_out, reminderCount, error,
                reminderCount, error
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async updateReminderRecord(bookingId, reminderCount, error) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO abandoned_checkout_reminders (booking_id, guest_email, reminder_count, last_reminder_sent_at, last_error)
                SELECT id, guest_email, ?, CURRENT_TIMESTAMP, ?
                FROM bookings WHERE id = ?
                ON CONFLICT(booking_id) DO UPDATE SET
                    reminder_count = ?,
                    last_reminder_sent_at = CURRENT_TIMESTAMP,
                    last_error = ?
            `;
            this.db.run(sql, [reminderCount, error, bookingId, reminderCount, error], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Get abandoned checkouts for admin dashboard
    async getAbandonedCheckouts() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT b.id, b.guest_name, b.guest_email, b.accommodation, b.check_in, b.check_out, 
                       b.total_price, b.created_at,
                       COALESCE(r.reminder_count, 0) as reminder_count,
                       r.last_reminder_sent_at, r.last_error
                FROM bookings b
                LEFT JOIN abandoned_checkout_reminders r ON b.id = r.booking_id
                WHERE b.stripe_session_id IS NOT NULL
                AND b.payment_status = 'pending'
                ORDER BY b.created_at DESC
                LIMIT 50
            `;
            this.db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Manually send reminder for a specific booking
    async sendManualReminder(bookingId) {
        return new Promise(async (resolve, reject) => {
            try {
                const booking = await new Promise((res, rej) => {
                    this.db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                        if (err) rej(err);
                        else res(row);
                    });
                });

                if (!booking) {
                    reject(new Error('Booking not found'));
                    return;
                }

                await this.sendAbandonedCheckoutReminder(booking);
                resolve({ success: true, message: 'Reminder sent successfully' });
            } catch (error) {
                reject(error);
            }
        });
    }

    // ==========================================
    // FEATURE 2: Availability Calendar
    // ==========================================

    async getAvailabilityCalendar(accommodation, month) {
        // month format: "2026-02"
        const [year, monthNum] = month.split('-').map(Number);
        const startDate = new Date(year, monthNum - 1, 1);
        const endDate = new Date(year, monthNum, 0); // Last day of month
        
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        return new Promise((resolve, reject) => {
            // Get all confirmed bookings that overlap with this month
            const sql = `
                SELECT check_in, check_out
                FROM bookings
                WHERE accommodation = ?
                AND payment_status = 'completed'
                AND check_out >= ?
                AND check_in <= ?
            `;
            
            this.db.all(sql, [accommodation, startStr, endStr], (err, bookings) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Generate list of unavailable dates
                const unavailableDates = new Set();
                
                for (const booking of bookings || []) {
                    const checkIn = new Date(booking.check_in);
                    const checkOut = new Date(booking.check_out);
                    
                    // Add all dates from check-in to check-out (exclusive of check-out)
                    const current = new Date(checkIn);
                    while (current < checkOut) {
                        const dateStr = current.toISOString().split('T')[0];
                        // Only include dates within the requested month
                        if (dateStr >= startStr && dateStr <= endStr) {
                            unavailableDates.add(dateStr);
                        }
                        current.setDate(current.getDate() + 1);
                    }
                }

                // Generate all dates in the month
                const allDates = [];
                const currentDate = new Date(startDate);
                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    allDates.push({
                        date: dateStr,
                        available: !unavailableDates.has(dateStr),
                        isPast: new Date(dateStr) < new Date(new Date().toISOString().split('T')[0])
                    });
                    currentDate.setDate(currentDate.getDate() + 1);
                }

                // Find next available dates
                const today = new Date().toISOString().split('T')[0];
                const nextAvailable = allDates.find(d => d.available && d.date >= today);

                resolve({
                    month: month,
                    accommodation: accommodation,
                    dates: allDates,
                    bookedRanges: bookings || [],
                    nextAvailableDate: nextAvailable ? nextAvailable.date : null,
                    totalDays: allDates.length,
                    availableDays: allDates.filter(d => d.available && !d.isPast).length
                });
            });
        });
    }

    // Get next available weekends for quick display
    async getNextAvailableWeekends(accommodation, count = 4) {
        const weekends = [];
        const currentDate = new Date();
        
        // Move to next Friday
        while (currentDate.getDay() !== 5) {
            currentDate.setDate(currentDate.getDate() + 1);
        }

        let checkedWeeks = 0;
        const maxWeeks = 16; // Check up to 16 weeks ahead

        while (weekends.length < count && checkedWeeks < maxWeeks) {
            const friday = new Date(currentDate);
            const sunday = new Date(currentDate);
            sunday.setDate(sunday.getDate() + 2);

            const fridayStr = friday.toISOString().split('T')[0];
            const sundayStr = sunday.toISOString().split('T')[0];

            // Check if this weekend is available
            const isAvailable = await this.checkDateRangeAvailable(accommodation, fridayStr, sundayStr);
            
            if (isAvailable) {
                weekends.push({
                    checkIn: fridayStr,
                    checkOut: sundayStr,
                    label: `${friday.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })}`
                });
            }

            // Move to next Friday
            currentDate.setDate(currentDate.getDate() + 7);
            checkedWeeks++;
        }

        return weekends;
    }

    async checkDateRangeAvailable(accommodation, checkIn, checkOut) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT COUNT(*) as count
                FROM bookings
                WHERE accommodation = ?
                AND payment_status = 'completed'
                AND check_in < ?
                AND check_out > ?
            `;
            this.db.get(sql, [accommodation, checkOut, checkIn], (err, row) => {
                if (err) reject(err);
                else resolve(row.count === 0);
            });
        });
    }

    // ==========================================
    // FEATURE 5: Automated Review Requests
    // ==========================================

    async processReviewRequests() {
        try {
            console.log('[Marketing] Processing review requests...');
            
            // Find completed bookings where:
            // - checkout was 1-3 days ago
            // - no review request sent yet
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const eligibleBookings = await new Promise((resolve, reject) => {
                const sql = `
                    SELECT b.*
                    FROM bookings b
                    LEFT JOIN review_requests r ON b.id = r.booking_id
                    WHERE b.payment_status = 'completed'
                    AND b.check_out <= ?
                    AND b.check_out >= ?
                    AND r.booking_id IS NULL
                `;
                this.db.all(sql, [oneDayAgo, threeDaysAgo], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            console.log(`[Marketing] Found ${eligibleBookings.length} bookings eligible for review requests`);

            for (const booking of eligibleBookings) {
                await this.sendReviewRequest(booking);
            }
        } catch (error) {
            console.error('[Marketing] Error processing review requests:', error);
        }
    }

    async sendReviewRequest(booking) {
        try {
            // Check if email is configured
            if (!this.emailTransporter || !process.env.EMAIL_USER) {
                await this.storeReviewRequestAsDraft(booking, 'Email not configured');
                return;
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: booking.guest_email,
                subject: `How was your stay at Lakeside Retreat?`,
                html: this.generateReviewRequestHtml(booking)
            };

            await this.emailTransporter.sendMail(mailOptions);
            
            // Record the review request
            await this.recordReviewRequest(booking.id, null);
            
            console.log(`[Marketing] Sent review request to ${booking.guest_email}`);
        } catch (error) {
            console.error(`[Marketing] Failed to send review request to ${booking.guest_email}:`, error.message);
            await this.recordReviewRequest(booking.id, error.message);
        }
    }

    generateReviewRequestHtml(booking) {
        const accommodationName = this.formatAccommodationName(booking.accommodation);
        
        // Review links - customize these with actual review URLs
        const googleReviewUrl = 'https://g.page/r/lakeside-retreat-cromwell/review';
        const airbnbUrl = 'https://www.airbnb.co.nz/users/show/lakesideretreat';
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background: #f9f9f9; }
                    .review-buttons { text-align: center; margin: 20px 0; }
                    .review-button { display: inline-block; padding: 12px 25px; margin: 5px; text-decoration: none; border-radius: 5px; color: white; }
                    .google { background: #4285f4; }
                    .airbnb { background: #ff5a5f; }
                    .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Thank You for Staying with Us!</h1>
                    </div>
                    <div class="content">
                        <p>Hi ${booking.guest_name || 'there'},</p>
                        
                        <p>We hope you had a wonderful time at ${accommodationName}! It was our pleasure hosting you.</p>
                        
                        <p>If you enjoyed your stay, we'd be incredibly grateful if you could take a moment to share your experience. Your review helps other travelers discover Lakeside Retreat and means the world to us as hosts.</p>
                        
                        <div class="review-buttons">
                            <a href="${googleReviewUrl}" class="review-button google">Review on Google</a>
                            <a href="${airbnbUrl}" class="review-button airbnb">Review on Airbnb</a>
                        </div>
                        
                        <p>Thank you for being part of our Lakeside Retreat family. We hope to welcome you back soon!</p>
                        
                        <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                    </div>
                    <div class="footer">
                        <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    async storeReviewRequestAsDraft(booking, error) {
        return this.recordReviewRequest(booking.id, error);
    }

    async recordReviewRequest(bookingId, error) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO review_requests (booking_id, guest_email, guest_name, accommodation, check_out, request_count, last_request_sent_at, last_error, status)
                SELECT id, guest_email, guest_name, accommodation, check_out, 1, CURRENT_TIMESTAMP, ?, ?
                FROM bookings WHERE id = ?
                ON CONFLICT(booking_id) DO UPDATE SET
                    request_count = request_count + 1,
                    last_request_sent_at = CURRENT_TIMESTAMP,
                    last_error = ?,
                    status = ?
            `;
            const status = error ? 'failed' : 'sent';
            this.db.run(sql, [error, status, bookingId, error, status], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Get review requests for admin dashboard
    async getReviewRequests(status = null) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT r.*, b.total_price
                FROM review_requests r
                JOIN bookings b ON r.booking_id = b.id
            `;
            const params = [];
            
            if (status) {
                sql += ' WHERE r.status = ?';
                params.push(status);
            }
            
            sql += ' ORDER BY r.created_at DESC LIMIT 50';
            
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Manually send review request
    async sendManualReviewRequest(bookingId) {
        return new Promise(async (resolve, reject) => {
            try {
                const booking = await new Promise((res, rej) => {
                    this.db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                        if (err) rej(err);
                        else res(row);
                    });
                });

                if (!booking) {
                    reject(new Error('Booking not found'));
                    return;
                }

                await this.sendReviewRequest(booking);
                resolve({ success: true, message: 'Review request sent successfully' });
            } catch (error) {
                reject(error);
            }
        });
    }

    // ==========================================
    // FEATURE 6: Social Content Helper
    // ==========================================

    async generateSocialContent(options) {
        const { platform, tone, sourceText, accommodation } = options;
        
        // Curated hashtags by category
        const hashtags = {
            location: ['#CentralOtago', '#Cromwell', '#LakeDunstan', '#NewZealand', '#SouthIsland', '#OtagoNZ'],
            accommodation: ['#Glamping', '#LuxuryGlamping', '#EcoDome', '#UniqueStays', '#BoutiqueAccommodation'],
            experience: ['#WineCountry', '#VineyardViews', '#LakeViews', '#Stargazing', '#RomanticGetaway'],
            sustainability: ['#EcoFriendly', '#SolarPowered', '#SustainableTravel', '#GreenTravel'],
            travel: ['#TravelNZ', '#ExploreNZ', '#NZMustDo', '#QueenstownLakes', '#WanakaTrip']
        };

        // Tone-specific templates
        const templates = {
            luxury: {
                instagram: [
                    `Experience luxury redefined at Lakeside Retreat. ${sourceText ? `"${sourceText}"` : 'Where vineyard views meet eco-conscious comfort.'} Book your escape today.`,
                    `Wake up to stunning lake views in our solar-powered eco-domes. ${sourceText || 'Pure luxury, zero environmental impact.'}`
                ],
                facebook: [
                    `Looking for a truly special getaway? Our guests say it best: ${sourceText ? `"${sourceText}"` : 'Lakeside Retreat offers an unforgettable experience in the heart of Central Otago wine country.'}`,
                    `Discover why Lakeside Retreat is Central Otago's premier eco-luxury accommodation. ${sourceText || 'Solar-powered domes with breathtaking views await.'}`
                ]
            },
            romantic: {
                instagram: [
                    `Love is in the air at Lakeside Retreat. ${sourceText ? `"${sourceText}"` : 'Private spa, stargazing skylights, and vineyard sunsets.'} Perfect for couples.`,
                    `Create memories that last a lifetime. ${sourceText || 'Our romantic eco-domes are the perfect backdrop for your love story.'}`
                ],
                facebook: [
                    `Planning a romantic escape? ${sourceText ? `Our guests share: "${sourceText}"` : 'Lakeside Retreat offers the perfect setting for couples seeking something special.'} Book your romantic getaway today.`,
                    `Anniversary? Honeymoon? Just because? ${sourceText || 'Our intimate eco-domes are designed for romance.'}`
                ]
            },
            family: {
                instagram: [
                    `Family adventures start here! ${sourceText ? `"${sourceText}"` : 'Our Lakeside Cottage is perfect for families exploring Central Otago.'} Pet-friendly too!`,
                    `Making memories with the whole family. ${sourceText || 'Space for everyone, views for days, and adventures around every corner.'}`
                ],
                facebook: [
                    `Looking for the perfect family getaway? ${sourceText ? `"${sourceText}"` : 'Our Lakeside Cottage offers space, comfort, and endless adventures for the whole family.'} Even the furry members are welcome!`,
                    `Family time is the best time. ${sourceText || 'Create unforgettable memories at Lakeside Retreat.'}`
                ]
            },
            eco: {
                instagram: [
                    `Travel sustainably without compromising on luxury. ${sourceText ? `"${sourceText}"` : 'Our 16.72kW solar system powers your entire stay.'} Zero guilt, maximum comfort.`,
                    `Energy-positive accommodation is possible. ${sourceText || 'We generate more power than we use - and you get to enjoy the views.'}`
                ],
                facebook: [
                    `Did you know? Lakeside Retreat is New Zealand's first energy-positive accommodation. ${sourceText ? `Our guests love it: "${sourceText}"` : 'Our commercial-grade solar array means your stay has zero environmental impact.'} Book your eco-conscious escape today.`,
                    `Sustainability meets luxury at Lakeside Retreat. ${sourceText || 'Powered by the sun, surrounded by nature.'}`
                ]
            }
        };

        // Select template based on tone and platform
        const toneTemplates = templates[tone] || templates.luxury;
        const platformTemplates = toneTemplates[platform] || toneTemplates.instagram;
        const caption = platformTemplates[Math.floor(Math.random() * platformTemplates.length)];

        // Select relevant hashtags (8-15 for Instagram, fewer for Facebook)
        const selectedHashtags = [];
        const hashtagCount = platform === 'instagram' ? 12 : 5;
        
        // Add hashtags from each category
        Object.values(hashtags).forEach(category => {
            const shuffled = category.sort(() => 0.5 - Math.random());
            selectedHashtags.push(...shuffled.slice(0, 2));
        });
        
        // Shuffle and limit
        const finalHashtags = selectedHashtags
            .sort(() => 0.5 - Math.random())
            .slice(0, hashtagCount);

        // Generate story text (shorter, more punchy)
        const storyTexts = {
            luxury: 'Luxury eco-domes on Lake Dunstan. Link in bio to book.',
            romantic: 'Romance awaits at Lakeside Retreat. Swipe up to book.',
            family: 'Family adventures in Central Otago. Book now!',
            eco: 'Solar-powered luxury. Zero impact, maximum comfort.'
        };

        const result = {
            platform,
            tone,
            caption,
            hashtags: finalHashtags.join(' '),
            storyText: storyTexts[tone] || storyTexts.luxury,
            accommodation: accommodation || 'all',
            generatedAt: new Date().toISOString()
        };

        // Optionally save to drafts
        if (options.saveDraft) {
            await this.saveSocialDraft(result, sourceText);
        }

        return result;
    }

    async saveSocialDraft(content, sourceText) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO social_content_drafts (platform, source_type, source_text, accommodation, generated_caption, hashtags, story_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            this.db.run(sql, [
                content.platform,
                sourceText ? 'review' : 'custom',
                sourceText || null,
                content.accommodation,
                content.caption,
                content.hashtags,
                content.storyText
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getSocialDrafts(status = 'draft') {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM social_content_drafts
                WHERE status = ?
                ORDER BY created_at DESC
                LIMIT 50
            `;
            this.db.all(sql, [status], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async updateDraftStatus(draftId, status) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE social_content_drafts SET status = ? WHERE id = ?', [status, draftId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // ==========================================
    // Helper Functions
    // ==========================================

    formatAccommodationName(accommodation) {
        const names = {
            'dome-pinot': 'Dome Pinot',
            'dome-rose': 'Dome Ros\u00e9',
            'lakeside-cottage': 'Lakeside Cottage'
        };
        return names[accommodation] || accommodation;
    }

    // Get marketing stats for admin dashboard
    async getMarketingStats() {
        const stats = {};

        // Abandoned checkouts stats
        stats.abandonedCheckouts = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN reminder_count > 0 THEN 1 ELSE 0 END) as reminded
                FROM bookings b
                LEFT JOIN abandoned_checkout_reminders r ON b.id = r.booking_id
                WHERE b.stripe_session_id IS NOT NULL AND b.payment_status = 'pending'
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total: 0, reminded: 0 });
            });
        });

        // Review requests stats
        stats.reviewRequests = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
                FROM review_requests
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total: 0, sent: 0, pending: 0 });
            });
        });

        // Social drafts stats
        stats.socialDrafts = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
                    SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted
                FROM social_content_drafts
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total: 0, drafts: 0, posted: 0 });
            });
        });

        return stats;
    }
}

module.exports = MarketingAutomation;
