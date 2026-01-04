const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();
const nodemailer = require('nodemailer');

// Initialize Stripe with error handling
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY environment variable is missing!');
    process.exit(1);
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Initialize SQLite database
const db = new sqlite3.Database('./lakeside.db', (err) => {
    if (err) {
        console.error('❌ Error connecting to database:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to SQLite database');
        
        // Create tables if they don't exist
        createTables();
    }
});

// Create necessary tables
function createTables() {
    // Create bookings table
    const createBookingsTable = `
        CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            guest_name TEXT NOT NULL,
            guest_email TEXT NOT NULL,
            guest_phone TEXT,
            accommodation TEXT NOT NULL,
            check_in DATE NOT NULL,
            check_out DATE NOT NULL,
            guests INTEGER NOT NULL,
            total_price DECIMAL(10,2),
            status TEXT DEFAULT 'confirmed',
            payment_status TEXT DEFAULT 'pending',
            notes TEXT,
            stripe_session_id TEXT,
            stripe_payment_id TEXT,
            uplisting_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;
    
    // Create contact_messages table
    const createContactTable = `
        CREATE TABLE IF NOT EXISTS contact_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.run(createBookingsTable, (err) => {
        if (err) {
            console.error('❌ Error creating bookings table:', err.message);
        } else {
            console.log('✅ Bookings table ready');
        }
    });

    db.run(createContactTable, (err) => {
        if (err) {
            console.error('❌ Error creating contact table:', err.message);
        } else {
            console.log('✅ Contact messages table ready');
        }
    });
}

// Email transporter setup
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Centralized Uplisting property mapping configuration
// Maps accommodation names to their Uplisting property IDs
function getUplistingPropertyMapping() {
    return {
        'dome-pinot': process.env.UPLISTING_PROPERTY_PINOT_ID,
        'dome-rose': process.env.UPLISTING_PROPERTY_ROSE_ID,
        'lakeside-cottage': process.env.UPLISTING_PROPERTY_COTTAGE_ID
    };
}

// Get Uplisting property ID from accommodation name
function getPropertyIdFromAccommodation(accommodation) {
    const mapping = getUplistingPropertyMapping();
    return mapping[accommodation] || null;
}

// Get accommodation name from Uplisting property ID (reverse lookup)
function getAccommodationFromPropertyId(propertyId) {
    if (!propertyId) {
        return 'unknown';
    }
    const mapping = getUplistingPropertyMapping();
    for (const [accommodation, id] of Object.entries(mapping)) {
        if (id && id === propertyId) {
            return accommodation;
        }
    }
    return 'unknown';
}

// Rate limiting middleware
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const bookingLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // limit each IP to 3 booking attempts per 5 minutes
    message: { error: 'Too many booking attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting
app.use(generalLimiter);

// Enable compression for all responses (60-80% size reduction)
app.use(compression());

// Minimal safe security headers (won't break frontend)
app.use(helmet({
    // SAFE: These headers are very conservative
    xContentTypeOptions: true,        // Prevents MIME sniffing (replaces noSniff)
    xFrameOptions: { action: 'sameorigin' }, // Allows same-origin frames
    xXssProtection: true,             // Basic XSS protection
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // DISABLED: These could break your site
    contentSecurityPolicy: false,    // Don't enable CSP - too risky
    crossOriginEmbedderPolicy: false, // Don't block embeds
    crossOriginResourcePolicy: false, // Don't block cross-origin resources
    originAgentCluster: false,        // Don't isolate origins
    
    // KEEP PERMISSIVE: Allow all functionality
    permittedCrossDomainPolicies: false,
    
    // Standard safe defaults
    ieNoOpen: true,
    dnsPrefetchControl: { allow: true }  // Allow DNS prefetching for performance
}));

// Stripe webhook MUST be registered BEFORE express.json() middleware
// because it needs the raw body for signature verification
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        const sql = `
            UPDATE bookings 
            SET payment_status = 'completed', status = 'confirmed', stripe_payment_id = ?
            WHERE stripe_session_id = ?
        `;
        
        db.run(sql, [session.payment_intent, session.id], function(err) {
            if (err) {
                console.error('Failed to update booking status:', err);
            } else {
                console.log('Booking confirmed for session:', session.id);
                
                db.get('SELECT * FROM bookings WHERE stripe_session_id = ?', [session.id], async (err, booking) => {
                    if (!err && booking) {
                        await syncBookingToUplisting(booking);
                        
                        await sendBookingConfirmation({
                            guest_name: session.metadata.guest_name,
                            guest_email: session.metadata.guest_email,
                            accommodation: session.metadata.accommodation,
                            check_in: session.metadata.check_in,
                            check_out: session.metadata.check_out,
                            guests: session.metadata.guests,
                            total_price: (session.amount_total / 100).toFixed(2)
                        });
                    }
                });
            }
        });
    }

    res.json({received: true});
});

// Middleware (AFTER Stripe webhook route)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Secure static file serving - only serve files from public directory
// This prevents exposure of sensitive files like lakeside.db, server.js, .env
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// CSRF Token endpoint
app.get('/api/csrf-token', (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        res.json({ 
            success: true,
            token: token,
            expires: Date.now() + (60 * 60 * 1000) // 1 hour
        });
    } catch (error) {
        console.error('❌ CSRF token generation error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate security token' 
        });
    }
});

// Accommodations endpoint
app.get('/api/accommodations', (req, res) => {
    try {
        const accommodations = [
            {
                id: 'dome-pinot',
                name: 'Dome Pinot',
                description: 'Luxury eco-dome with vineyard views and spa bath',
                maxGuests: 2,
                basePrice: 295,
                weekendPrice: 325,
                peakPrice: 350,
                amenities: ['King bed', 'Spa bath', 'Vineyard views', 'Solar powered'],
                images: ['dome-pinot-exterior.jpeg', 'dome-pinot-interior.jpeg']
            },
            {
                id: 'dome-rose',
                name: 'Dome Rosé',
                description: 'Romantic eco-dome with mountain views and outdoor spa',
                maxGuests: 2,
                basePrice: 295,
                weekendPrice: 325,
                peakPrice: 350,
                amenities: ['King bed', 'Outdoor spa', 'Mountain views', 'Solar powered'],
                images: ['dome-rose-exterior.jpeg', 'dome-rose-interior.jpeg']
            },
            {
                id: 'lakeside-cottage',
                name: 'Lakeside Cottage',
                description: 'Spacious cottage with lake views, perfect for families',
                maxGuests: 6,
                basePrice: 245,
                weekendPrice: 275,
                peakPrice: 300,
                extraGuestFee: 100,
                petFee: 25,
                amenities: ['2 bedrooms', 'Full kitchen', 'Lake views', 'Pet friendly'],
                images: ['lakesidecottageexterior.jpeg', 'lakesidecottageinterior.jpeg']
            }
        ];
        
        res.json({
            success: true,
            accommodations: accommodations
        });
    } catch (error) {
        console.error('❌ Accommodations endpoint error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to load accommodations' 
        });
    }
});

// Contact form endpoint
app.post('/api/contact', [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('message').trim().isLength({ min: 10, max: 1000 }).escape()
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Invalid contact form data',
                details: errors.array()
            });
        }

        const { name, email, message } = req.body;

        // Sanitize inputs
        const sanitizedData = {
            name: sanitizeInput(name),
            email: email,
            message: sanitizeInput(message)
        };

        // Send email notification
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.CONTACT_EMAIL || process.env.EMAIL_USER,
            subject: `Website Contact from ${sanitizedData.name}`,
            html: `
                <h2>New Contact Form Submission</h2>
                <p><strong>Name:</strong> ${sanitizedData.name}</p>
                <p><strong>Email:</strong> ${sanitizedData.email}</p>
                <p><strong>Message:</strong></p>
                <p>${sanitizedData.message.replace(/\n/g, '<br>')}</p>
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
            // Don't fail the request if email fails
        }

        // Store in database (optional)
        const sql = `
            INSERT INTO contact_messages (name, email, message, created_at)
            VALUES (?, ?, ?, datetime('now'))
        `;

        db.run(sql, [sanitizedData.name, sanitizedData.email, sanitizedData.message], function(err) {
            if (err) {
                console.error('❌ Failed to store contact message:', err);
                // Don't fail the request if database storage fails
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

// Input validation middleware
const validateBooking = [
    body('guest_name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('guest_email').isEmail().normalizeEmail(),
    body('guest_phone').optional().isMobilePhone(),
    body('accommodation').isIn(['dome-pinot', 'dome-rose', 'lakeside-cottage']),
    body('check_in').isISO8601().toDate(),
    body('check_out').isISO8601().toDate(),
    body('guests').isInt({ min: 1, max: 8 }),
    body('total_price').isFloat({ min: 0 }),
    body('notes').optional().isLength({ max: 500 }).escape()
];

// Utility functions
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>\"\']/g, '');
}

function calculateNights(checkIn, checkOut) {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const timeDifference = checkOutDate.getTime() - checkInDate.getTime();
    return Math.ceil(timeDifference / (1000 * 3600 * 24));
}

function validateSeasonalMinimumStay(accommodation, checkIn, checkOut) {
    if (accommodation === 'lakeside-cottage') {
        const checkInDate = new Date(checkIn);
        const month = checkInDate.getMonth() + 1; // JS months are 0-based
        
        // Peak season: Oct (10) through May (5) - includes crossing year boundary
        const isPeakSeason = month >= 10 || month <= 5;
        
        if (isPeakSeason) {
            const nights = calculateNights(checkIn, checkOut);
            if (nights < 2) {
                return {
                    valid: false,
                    error: "Minimum 2-night stay required for Lakeside Cottage during peak season (October to May)"
                };
            }
        }
    }
    return { valid: true };
}

// Uplisting API integration
async function checkUplistingAvailability(accommodation, checkIn, checkOut) {
    if (!process.env.UPLISTING_API_KEY) {
        console.warn('⚠️ Uplisting API key not configured, using local availability only');
        return true;
    }
    
    try {
        // Use centralized property mapping
        const propertyId = getPropertyIdFromAccommodation(accommodation);
        if (!propertyId) {
            console.warn(`⚠️ No Uplisting property ID configured for ${accommodation}`);
            return true;
        }
        
        const url = `https://connect.uplisting.io/properties/${propertyId}/availability?start_date=${checkIn}&end_date=${checkOut}`;
        console.log('🔍 Checking Uplisting availability:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.UPLISTING_API_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('📡 Uplisting API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Uplisting API error:', response.status, errorText);
            return true; // Fail open - allow booking if API is down
        }
        
        const data = await response.json();
        console.log('📝 Uplisting availability data:', data);
        return data.available === true;
        
    } catch (error) {
        console.error('❌ Uplisting availability check failed:', error);
        return true; // Fail open - allow booking if API fails
    }
}

// Booking availability check (checks both local DB and Uplisting)
async function checkAvailability(accommodation, checkIn, checkOut) {
    let localAvailable = true; // Default to available
    
    try {
        // Check local database first
        localAvailable = await new Promise((resolve, reject) => {
            const sql = `
                SELECT COUNT(*) as conflicts 
                FROM bookings 
                WHERE accommodation = ? 
                AND payment_status = 'completed'
                AND (
                    (check_in <= ? AND check_out > ?) OR
                    (check_in < ? AND check_out >= ?) OR
                    (check_in >= ? AND check_out <= ?)
                )
            `;
            
            db.get(sql, [accommodation, checkIn, checkIn, checkOut, checkOut, checkIn, checkOut], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.conflicts === 0);
                }
            });
        });
        
        if (!localAvailable) {
            return false; // Local conflict found
        }
        
        // Check Uplisting availability
        const uplistingAvailable = await checkUplistingAvailability(accommodation, checkIn, checkOut);
        
        return uplistingAvailable;
        
    } catch (error) {
        console.error('❌ Availability check error:', error);
        console.log('📝 Availability check failed, allowing booking based on local DB only');
        // If availability check fails, return the local DB result (default to true if DB check failed)
        return localAvailable;
    }
}

// Sync booking to Uplisting
async function syncBookingToUplisting(bookingData) {
    if (!process.env.UPLISTING_API_KEY) {
        console.warn('⚠️ Uplisting API key not configured, booking not synced');
        return;
    }
    
    try {
        // Use centralized property mapping
        const propertyId = getPropertyIdFromAccommodation(bookingData.accommodation);
        if (!propertyId) {
            console.warn(`⚠️ No Uplisting property ID configured for ${bookingData.accommodation}`);
            return;
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
        
        const response = await fetch('https://connect.uplisting.io/bookings', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.UPLISTING_API_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(uplistingBooking)
        });
        
        if (response.ok) {
            const uplistingResponse = await response.json();
            console.log('✅ Booking synced to Uplisting:', uplistingResponse.id);
            
            // Update local booking with Uplisting ID
            db.run(
                'UPDATE bookings SET uplisting_id = ? WHERE id = ?',
                [uplistingResponse.id, bookingData.id],
                (err) => {
                    if (err) {
                        console.error('❌ Failed to update Uplisting ID:', err);
                    }
                }
            );
        } else {
            console.error('❌ Failed to sync booking to Uplisting:', response.status);
        }
        
    } catch (error) {
        console.error('❌ Uplisting sync error:', error);
    }
}

// Uplisting webhook handler
app.post('/api/uplisting/webhook', express.json(), (req, res) => {
    try {
        // Verify webhook signature if secret is configured
        if (process.env.UPLISTING_WEBHOOK_SECRET) {
            const signature = req.headers['x-uplisting-signature'];
            const expectedSignature = crypto
                .createHmac('sha256', process.env.UPLISTING_WEBHOOK_SECRET)
                .update(JSON.stringify(req.body))
                .digest('hex');
            
            if (signature !== expectedSignature) {
                console.error('❌ Invalid Uplisting webhook signature');
                return res.status(400).json({ error: 'Invalid signature' });
            }
        }
        
        const { event, data } = req.body;
        
        if (event === 'booking.created' || event === 'booking.updated') {
            // Sync Uplisting booking to local database
            const bookingData = {
                id: `uplisting-${data.id}`,
                guest_name: `${data.guest.first_name} ${data.guest.last_name}`.trim(),
                guest_email: data.guest.email,
                guest_phone: data.guest.phone || '',
                accommodation: getAccommodationFromPropertyId(data.property_id),
                check_in: data.check_in,
                check_out: data.check_out,
                guests: data.guests,
                total_price: data.total_amount,
                status: data.status === 'confirmed' ? 'confirmed' : 'pending',
                payment_status: data.payment_status || 'completed',
                notes: data.notes || 'Booking from Uplisting',
                uplisting_id: data.id
            };
            
            // Insert or update booking
            const sql = `
                INSERT OR REPLACE INTO bookings (
                    id, guest_name, guest_email, guest_phone, accommodation,
                    check_in, check_out, guests, total_price, status,
                    payment_status, notes, uplisting_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `;
            
            db.run(sql, [
                bookingData.id,
                bookingData.guest_name,
                bookingData.guest_email,
                bookingData.guest_phone,
                bookingData.accommodation,
                bookingData.check_in,
                bookingData.check_out,
                bookingData.guests,
                bookingData.total_price,
                bookingData.status,
                bookingData.payment_status,
                bookingData.notes,
                bookingData.uplisting_id
            ], (err) => {
                if (err) {
                    console.error('❌ Failed to sync Uplisting booking:', err);
                } else {
                    console.log('✅ Uplisting booking synced:', data.id);
                }
            });
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('❌ Uplisting webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Send booking confirmation email
async function sendBookingConfirmation(bookingData) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: bookingData.guest_email,
        subject: 'Booking Confirmation - Lakeside Retreat',
        html: `
            <h2>Booking Confirmation</h2>
            <p>Dear ${bookingData.guest_name},</p>
            <p>Your booking has been confirmed!</p>
            
            <h3>Booking Details:</h3>
            <ul>
                <li><strong>Accommodation:</strong> ${bookingData.accommodation}</li>
                <li><strong>Check-in:</strong> ${bookingData.check_in}</li>
                <li><strong>Check-out:</strong> ${bookingData.check_out}</li>
                <li><strong>Guests:</strong> ${bookingData.guests}</li>
                <li><strong>Total:</strong> $${bookingData.total_price} NZD</li>
            </ul>
            
            <p>We look forward to hosting you!</p>
            <p>Best regards,<br>Lakeside Retreat Team</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log('✅ Booking confirmation email sent to:', bookingData.guest_email);
    } catch (error) {
        console.error('❌ Failed to send booking confirmation:', error);
    }
}

// BOOKING ENDPOINTS

// Process booking endpoint (called by frontend)
app.post('/api/process-booking', bookingLimiter, validateBooking, async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Invalid booking data',
                details: errors.array()
            });
        }

        const {
            guest_name,
            guest_email,
            guest_phone,
            accommodation,
            check_in,
            check_out,
            guests,
            total_price,
            notes
        } = req.body;

        console.log('📝 Processing booking request for:', req.body.accommodation);
        
        // Sanitize inputs
        const sanitizedData = {
            guest_name: sanitizeInput(guest_name),
            guest_email: guest_email,
            guest_phone: sanitizeInput(guest_phone),
            accommodation: accommodation,
            check_in: new Date(check_in).toISOString().split('T')[0],
            check_out: new Date(check_out).toISOString().split('T')[0],
            guests: parseInt(guests),
            total_price: parseFloat(total_price),
            notes: sanitizeInput(notes)
        };

        // Validate dates
        const checkInDate = new Date(sanitizedData.check_in);
        const checkOutDate = new Date(sanitizedData.check_out);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (checkInDate < today) {
            return res.status(400).json({
                success: false,
                error: 'Check-in date cannot be in the past'
            });
        }

        if (checkOutDate <= checkInDate) {
            return res.status(400).json({
                success: false,
                error: 'Check-out date must be after check-in date'
            });
        }

        // Validate seasonal minimum stay for cottage (October to May = 2 nights minimum)
        const seasonalValidation = validateSeasonalMinimumStay(sanitizedData.accommodation, sanitizedData.check_in, sanitizedData.check_out);
        if (!seasonalValidation.valid) {
            return res.status(400).json({
                success: false,
                error: seasonalValidation.error
            });
        }

        console.log('🔍 Checking availability for dates:', sanitizedData.check_in, 'to', sanitizedData.check_out);
        
        // Check availability
        const isAvailable = await checkAvailability(
            sanitizedData.accommodation,
            sanitizedData.check_in,
            sanitizedData.check_out
        );

        console.log('📅 Availability check result:', isAvailable);

        if (!isAvailable) {
            return res.status(409).json({
                success: false,
                error: 'Selected dates are not available'
            });
        }

        console.log('💳 Creating Stripe checkout session...');
        console.log('🔑 Stripe key configured:', process.env.STRIPE_SECRET_KEY ? 'YES' : 'NO');
        console.log('🛒 Booking data:', sanitizedData);

        // Create Stripe checkout session
        let session;
        try {
            session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'nzd',
                    product_data: {
                        name: `${accommodation} - Lakeside Retreat`,
                        description: `${sanitizedData.check_in} to ${sanitizedData.check_out} (${sanitizedData.guests} guests)`
                    },
                    unit_amount: Math.round(sanitizedData.total_price * 100) // Convert to cents
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/booking-cancelled`,
            metadata: {
                guest_name: sanitizedData.guest_name,
                guest_email: sanitizedData.guest_email,
                guest_phone: sanitizedData.guest_phone || '',
                accommodation: sanitizedData.accommodation,
                check_in: sanitizedData.check_in,
                check_out: sanitizedData.check_out,
                guests: sanitizedData.guests.toString(),
                notes: sanitizedData.notes || ''
            }
        });
            console.log('✅ Stripe session created successfully:', session.id);
        } catch (stripeError) {
            console.error('❌ Stripe session creation failed:', stripeError.message);
            console.error('❌ Stripe error details:', stripeError);
            return res.status(500).json({
                success: false,
                error: 'Payment system error. Please try again or contact support.'
            });
        }

        // Store pending booking
        const bookingId = uuidv4();
        console.log('🗄️ Storing booking with ID:', bookingId);
        const sql = `
            INSERT INTO bookings (
                id, guest_name, guest_email, guest_phone, accommodation,
                check_in, check_out, guests, total_price, status,
                payment_status, notes, stripe_session_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, datetime('now'))
        `;

        db.run(sql, [
            bookingId,
            sanitizedData.guest_name,
            sanitizedData.guest_email,
            sanitizedData.guest_phone,
            sanitizedData.accommodation,
            sanitizedData.check_in,
            sanitizedData.check_out,
            sanitizedData.guests,
            sanitizedData.total_price,
            sanitizedData.notes,
            session.id
        ], function(err) {
            if (err) {
                console.error('❌ Database error:', err);
                console.error('❌ Database error details:', err.message);
                console.error('❌ SQL attempted:', sql);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + err.message
                });
            }

            console.log('✅ Booking stored successfully with ID:', bookingId);
            res.json({
                success: true,
                booking_id: bookingId,
                checkout_url: session.url,
                message: 'Booking created successfully'
            });
        });

    } catch (error) {
        console.error('❌ Booking processing error:', error);
        console.error('❌ Error stack:', error.stack);
        
        // More specific error messages for debugging
        let errorMessage = 'Internal server error';
        if (error.message.includes('stripe')) {
            errorMessage = 'Payment processing error: ' + error.message;
        } else if (error.message.includes('database')) {
            errorMessage = 'Database error: ' + error.message;
        } else if (error.message.includes('validation')) {
            errorMessage = 'Validation error: ' + error.message;
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            debug: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Note: /api/create-booking endpoint removed - use /api/process-booking instead
// Note: Stripe webhook moved to top of file (before express.json middleware) for proper raw body handling

// Get booking status
app.get('/api/booking/:id', (req, res) => {
    const bookingId = req.params.id;
    
    const sql = `
        SELECT id, guest_name, accommodation, check_in, check_out, 
               guests, total_price, status, payment_status, created_at
        FROM bookings 
        WHERE id = ?
    `;
    
    db.get(sql, [bookingId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ success: true, booking: row });
    });
});

// Admin login endpoint
app.post('/api/admin/login', adminLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        // Check username
        if (username !== process.env.ADMIN_USERNAME) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Check password against hash
        const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { username: username, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        res.json({ 
            success: true, 
            token: token,
            message: 'Login successful'
        });
        
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Admin verification endpoint
app.get('/api/admin/verify', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ valid: true, user: decoded });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Admin middleware
const verifyAdmin = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        req.admin = decoded;
        next();
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ADMIN BOOKING MANAGEMENT ENDPOINTS

// Get all bookings (admin only) - Enhanced with Stripe/Uplisting status
app.get('/api/admin/bookings', verifyAdmin, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    
    let sql = `
        SELECT id, guest_name, guest_email, guest_phone, accommodation,
               check_in, check_out, guests, total_price, status,
               payment_status, created_at, stripe_payment_id, stripe_session_id,
               uplisting_id, updated_at
        FROM bookings
    `;
    
    let params = [];
    
    if (status) {
        sql += ' WHERE status = ?';
        params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Get total count
        let countSql = 'SELECT COUNT(*) as total FROM bookings';
        let countParams = [];
        
        if (status) {
            countSql += ' WHERE status = ?';
            countParams.push(status);
        }
        
        db.get(countSql, countParams, (err, countRow) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
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

// Get booking details (admin only)
app.get('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    const sql = `
        SELECT * FROM bookings WHERE id = ?
    `;
    
    db.get(sql, [bookingId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ success: true, booking: row });
    });
});

// Update booking status (admin only)
app.put('/api/admin/booking/:id/status', verifyAdmin, [
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
    
    let sql = 'UPDATE bookings SET status = ?, updated_at = datetime("now")';
    let params = [status];
    
    if (notes) {
        sql += ', notes = ?';
        params.push(sanitizeInput(notes));
    }
    
    sql += ' WHERE id = ?';
    params.push(bookingId);
    
    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({
            success: true,
            message: 'Booking status updated'
        });
    });
});

// Delete booking (admin only)
app.delete('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    db.run('DELETE FROM bookings WHERE id = ?', [bookingId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({
            success: true,
            message: 'Booking deleted'
        });
    });
});

// Get booking statistics (admin only) - optimized single query
app.get('/api/admin/stats', verifyAdmin, (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
            COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
            COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
            COUNT(CASE WHEN DATE(created_at) = DATE('now') THEN 1 END) as today_bookings
        FROM bookings
    `;
    
    db.get(sql, (err, row) => {
        if (err) {
            console.error('Stats query error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        res.json({
            success: true,
            stats: {
                total_bookings: row.total_bookings || 0,
                pending_bookings: row.pending_bookings || 0,
                confirmed_bookings: row.confirmed_bookings || 0,
                total_revenue: row.total_revenue || 0,
                today_bookings: row.today_bookings || 0
            }
        });
    });
});

// Serve static files with proper MIME types
app.get('/sw.js', (req, res) => {
    const swPath = path.join(__dirname, 'public', 'sw.js');
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(swPath, (err) => {
        if (err) {
            res.status(404).send('Service worker not found');
        }
    });
});

// Enhanced Admin API Endpoints for Stripe/Uplisting Integration
// IMPORTANT: These must be defined BEFORE the catch-all route

// Get Stripe payment details for a booking
app.get('/api/admin/stripe-payment/:sessionId', verifyAdmin, async (req, res) => {
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
app.get('/api/admin/uplisting-booking/:bookingId', verifyAdmin, async (req, res) => {
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
app.post('/api/admin/refund/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, reason } = req.body;
        
        // Get booking from database
        db.get(
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
                    
                    db.run(
                        'UPDATE bookings SET status = ?, payment_status = ?, updated_at = datetime("now") WHERE id = ?',
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

// Cancel Uplisting booking helper
async function cancelUplistingBooking(uplistingId) {
    if (!process.env.UPLISTING_API_KEY || !uplistingId) return;
    
    try {
        const response = await fetch(`https://connect.uplisting.io/bookings/${uplistingId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.UPLISTING_API_KEY).toString('base64')}`,
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

// Retry failed booking sync
app.post('/api/admin/retry-sync/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        db.get(
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
                    db.get(
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
app.get('/api/admin/booking-stats', verifyAdmin, (req, res) => {
    const stats = {};
    
    // Get overall stats
    db.get(
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
            db.all(
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

// SPA routing - serve index.html for HTML routes only
// MUST BE THE LAST ROUTE (catch-all)
app.get('*', (req, res) => {
    // Don't serve index.html for API routes, static assets, or known file extensions
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
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    console.log(`🔑 Stripe configured:`, process.env.STRIPE_SECRET_KEY ? 'YES' : 'NO');
    console.log(`📧 Email configured:`, process.env.EMAIL_USER ? 'YES' : 'NO');
    console.log(`🏨 Uplisting configured:`, process.env.UPLISTING_API_KEY ? 'YES' : 'NO');
});
