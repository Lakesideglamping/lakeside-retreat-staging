const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();
const nodemailer = require('nodemailer');
const db = require('./db');

if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY environment variable is missing!');
    process.exit(1);
}
if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is missing!');
    process.exit(1);
}
if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is missing!');
    process.exit(1);
}
if (!process.env.PUBLIC_BASE_URL) {
    console.warn('PUBLIC_BASE_URL not set, using default. Set this for production security.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);

db.initializeDatabase()
    .then(() => {
        console.log('Connected to PostgreSQL database');
    })
    .catch((err) => {
        console.error('Error connecting to database:', err.message);
        process.exit(1);
    });

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

// Centralized Uplisting API configuration
// Returns the base URL for Uplisting API calls
function getUplistingBaseUrl() {
    return process.env.UPLISTING_API_URL || process.env.UPLISTING_BASE_URL || 'https://connect.uplisting.io';
}

// Returns auth headers for Uplisting API calls
// Configurable auth mode via UPLISTING_AUTH_MODE env var:
// - 'basic' (default): Authorization: Basic base64({api_key}) - Uplisting's documented format
// - 'basic_username': Authorization: Basic base64({api_key}:)
// - 'basic_password': Authorization: Basic base64(:{api_key})
// - 'bearer': Authorization: Bearer {api_key}
// - 'token': Authorization: Token token="{api_key}"
// - 'token_simple': Authorization: Token {api_key}
// - 'apikey': Authorization: ApiKey {api_key}
// - 'x_api_key': X-API-Key: {api_key} (custom header, not Authorization)
function getUplistingApiKey() {
    const rawApiKey = process.env.UPLISTING_API_KEY || '';
    // Trim whitespace and remove any accidental scheme prefixes
    let apiKey = rawApiKey.trim();
    
    // Check if the key already has a scheme prefix and strip it
    if (apiKey.toLowerCase().startsWith('bearer ')) {
        apiKey = apiKey.substring(7).trim();
    } else if (apiKey.toLowerCase().startsWith('basic ')) {
        apiKey = apiKey.substring(6).trim();
    } else if (apiKey.toLowerCase().startsWith('token ')) {
        apiKey = apiKey.substring(6).trim();
    }
    
    return apiKey;
}

function getUplistingAuthHeaders() {
    const apiKey = getUplistingApiKey();
    const clientId = process.env.UPLISTING_CLIENT_ID;
    
    if (!apiKey) {
        console.warn('Warning: UPLISTING_API_KEY is not set or empty');
        return { 'Authorization': 'Basic ' };
    }
    
    // Default to 'basic' which is Uplisting's documented auth format
    const authMode = (process.env.UPLISTING_AUTH_MODE || 'basic').toLowerCase().trim();
    console.log(`Uplisting auth mode: ${authMode}, API key length: ${apiKey.length}, Client ID: ${clientId ? 'configured' : 'not configured'}`);
    
    let headers = {};
    
    switch (authMode) {
        case 'basic':
            // Uplisting's documented format: API key base64 encoded directly
            // See: https://documenter.getpostman.com/view/1320372/SWTBfdW6
            headers['Authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
            break;
        case 'basic_username':
            // API key as username with empty password
            headers['Authorization'] = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
            break;
        case 'basic_password':
            // Empty username with API key as password
            headers['Authorization'] = `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`;
            break;
        case 'token':
            // Rails-style token auth with token= syntax
            headers['Authorization'] = `Token token="${apiKey}"`;
            break;
        case 'token_simple':
            // Simple token auth without token= syntax
            headers['Authorization'] = `Token ${apiKey}`;
            break;
        case 'apikey':
            // ApiKey scheme
            headers['Authorization'] = `ApiKey ${apiKey}`;
            break;
        case 'x_api_key':
            // X-API-Key custom header (not Authorization)
            headers['X-API-Key'] = apiKey;
            break;
        case 'bearer':
            headers['Authorization'] = `Bearer ${apiKey}`;
            break;
        default:
            // Default to Uplisting's documented format
            headers['Authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`;
    }
    
    // Add X-Uplisting-Client-ID header if configured (required for V2 Partner API endpoints)
    if (clientId) {
        headers['X-Uplisting-Client-ID'] = clientId;
    }
    
    return headers;
}

// Legacy function for backward compatibility - returns just the Authorization header value
function getUplistingAuthHeader() {
    const headers = getUplistingAuthHeaders();
    // Return the Authorization header value, or empty string if using X-API-Key
    return headers['Authorization'] || '';
}

// Centralized Uplisting property mapping configuration
// Maps accommodation names to their Uplisting property IDs
function getUplistingPropertyMapping() {
    return {
        'dome-pinot': process.env.UPLISTING_PINOT_ID,
        'dome-rose': process.env.UPLISTING_ROSE_ID,
        'lakeside-cottage': process.env.UPLISTING_COTTAGE_ID
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

// Health check skip function - handles trailing slashes and uses startsWith for robustness
const isHealthCheckPath = (req) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    return path === '/health' || path === '/healthz' || path === '/api/health' || 
           path.startsWith('/health') || path.startsWith('/api/health');
};

// Rate limiting middleware
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for health check endpoints (Render health checks are frequent)
    skip: isHealthCheckPath,
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

const contactLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // limit each IP to 3 contact form submissions per 10 minutes
    message: { error: 'Too many messages sent, please try again in 10 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Health check endpoints - defined BEFORE rate limiting to ensure they're never blocked
// This is a belt-and-suspenders approach: even if skip logic fails, health checks work
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

app.get('/healthz', async (req, res) => {
    try {
        const dbHealthy = await db.healthCheck();
        if (dbHealthy) {
            res.json({ status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
        } else {
            res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
        }
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const dbHealthy = await db.healthCheck();
        res.json({ status: 'healthy', database: dbHealthy ? 'connected' : 'disconnected', timestamp: new Date().toISOString() });
    } catch (err) {
        res.json({ status: 'degraded', database: 'error', timestamp: new Date().toISOString() });
    }
});

// Apply rate limiting (after health check routes so they're never rate limited)
app.use(generalLimiter);

// Enable compression for all responses (60-80% size reduction)
app.use(compression());

// Security headers
app.use(helmet({
    xContentTypeOptions: true,
    xFrameOptions: { action: 'sameorigin' },
    xXssProtection: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    hsts: {
        maxAge: 31536000,
        includeSubDomains: false,
        preload: false
    },
    
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'", 
                "https://js.stripe.com",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://www.clarity.ms",
                "https://scripts.clarity.ms",
                "https://cdn.jsdelivr.net"
            ],
            // Allow inline event handlers (onclick, onchange, etc.) - required for site navigation
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
                        connectSrc: [
                            "'self'", 
                            "https://api.stripe.com",
                            "https://www.google-analytics.com",
                            "https://*.google-analytics.com",
                            "https://www.clarity.ms",
                            "https://c.clarity.ms",
                            "https://k.clarity.ms",
                            "https://scripts.clarity.ms",
                            "https://fonts.googleapis.com",
                            "https://cdnjs.cloudflare.com"
                        ],
            frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    permittedCrossDomainPolicies: false,
    
    ieNoOpen: true,
    dnsPrefetchControl: { allow: true }
}));

app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
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
        
        try {
            await db.run(
                `UPDATE bookings 
                 SET payment_status = 'completed', status = 'confirmed', stripe_payment_id = $1, updated_at = NOW()
                 WHERE stripe_session_id = $2`,
                [session.payment_intent, session.id]
            );
            console.log('Booking confirmed for session:', session.id);
            
            const booking = await db.getOne('SELECT * FROM bookings WHERE stripe_session_id = $1', [session.id]);
            if (booking) {
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
        } catch (err) {
            console.error('Failed to update booking status:', err);
        }
    }

    res.json({received: true});
});

// Middleware (AFTER Stripe webhook route)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Secure static file serving - only serve files from public directory
// This prevents exposure of sensitive files like lakeside.db, server.js, .env
app.use(express.static(path.join(__dirname, 'public')));

// Note: Health check routes (/health, /healthz, /api/health) are defined earlier
// before rate limiting middleware to ensure they're never blocked

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
app.post('/api/contact', contactLimiter, [
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
            console.log('✅ Contact form email sent successfully');
        } catch (emailError) {
            console.error('❌ Failed to send contact email:', emailError);
            // Don't fail the request if email fails
        }

        try {
            const result = await db.run(
                `INSERT INTO contact_messages (name, email, message, created_at)
                 VALUES ($1, $2, $3, NOW())
                 RETURNING id`,
                [sanitizedData.name, sanitizedData.email, sanitizedData.message]
            );
            console.log('Contact message stored with ID:', result.rows[0]?.id);
        } catch (dbErr) {
            console.error('Failed to store contact message:', dbErr);
        }

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

// Availability check endpoint (called by frontend before booking)
app.post('/api/availability', bookingLimiter, async (req, res) => {
    try {
        const { accommodation, checkIn, checkOut, guests } = req.body;
        
        // Validate required fields
        if (!accommodation || !checkIn || !checkOut) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: accommodation, checkIn, checkOut'
            });
        }
        
        // Validate accommodation type
        const validAccommodations = ['dome-pinot', 'dome-rose', 'lakeside-cottage'];
        if (!validAccommodations.includes(accommodation)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid accommodation type'
            });
        }
        
        // Validate dates
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format'
            });
        }
        
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
        
        // Format dates for availability check
        const formattedCheckIn = checkInDate.toISOString().split('T')[0];
        const formattedCheckOut = checkOutDate.toISOString().split('T')[0];
        
        // Validate seasonal minimum stay for cottage
        const seasonalValidation = validateSeasonalMinimumStay(accommodation, formattedCheckIn, formattedCheckOut);
        if (!seasonalValidation.valid) {
            return res.status(400).json({
                success: false,
                error: seasonalValidation.error,
                available: false
            });
        }
        
        console.log('🔍 Checking availability for:', accommodation, formattedCheckIn, 'to', formattedCheckOut);
        
        // Check availability using existing function (returns object with available and error)
        const availabilityResult = await checkAvailability(accommodation, formattedCheckIn, formattedCheckOut);
        
        console.log('📅 Availability result:', availabilityResult);
        
        if (!availabilityResult.available) {
            return res.status(409).json({
                success: false,
                available: false,
                error: availabilityResult.error || 'Selected dates are not available',
                accommodation: accommodation,
                checkIn: formattedCheckIn,
                checkOut: formattedCheckOut
            });
        }
        
        res.json({
            success: true,
            available: true,
            accommodation: accommodation,
            checkIn: formattedCheckIn,
            checkOut: formattedCheckOut
        });
        
    } catch (error) {
        console.error('❌ Availability check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check availability. Please try again.'
        });
    }
});

// Simple in-memory cache for blocked dates (5 minute TTL)
const blockedDatesCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Blocked dates endpoint for calendar display
app.get('/api/blocked-dates', generalLimiter, async (req, res) => {
    try {
        const { accommodation, startDate, endDate } = req.query;
        
        // Validate required fields
        if (!accommodation) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: accommodation'
            });
        }
        
        // Validate accommodation type
        const validAccommodations = ['dome-pinot', 'dome-rose', 'lakeside-cottage'];
        if (!validAccommodations.includes(accommodation)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid accommodation type'
            });
        }
        
        // Default date range: today to 12 months from now
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const defaultEnd = new Date(today);
        defaultEnd.setMonth(defaultEnd.getMonth() + 12);
        
        const start = startDate ? new Date(startDate) : today;
        const end = endDate ? new Date(endDate) : defaultEnd;
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format'
            });
        }
        
        const formattedStart = start.toISOString().split('T')[0];
        const formattedEnd = end.toISOString().split('T')[0];
        
        // Check cache first
        const cacheKey = `${accommodation}-${formattedStart}-${formattedEnd}`;
        const cached = blockedDatesCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                blockedDates: cached.dates,
                accommodation: accommodation,
                startDate: formattedStart,
                endDate: formattedEnd,
                cached: true
            });
        }
        
        // Query local database for confirmed bookings
        const bookings = await db.getAll(
            `SELECT check_in, check_out 
             FROM bookings 
             WHERE accommodation = $1 
             AND payment_status IN ('completed', 'pending')
             AND check_out > $2 
             AND check_in < $3
             ORDER BY check_in`,
            [accommodation, formattedStart, formattedEnd]
        );
        
        // Generate list of blocked dates (all dates from check_in to check_out - 1)
        // Check-out day is NOT blocked (guest can check in on someone else's check-out day)
        const blockedDates = new Set();
        
        for (const booking of bookings) {
            const checkIn = new Date(booking.check_in);
            const checkOut = new Date(booking.check_out);
            
            // Add all dates from check_in to check_out - 1
            const current = new Date(checkIn);
            while (current < checkOut) {
                const dateStr = current.toISOString().split('T')[0];
                if (dateStr >= formattedStart && dateStr <= formattedEnd) {
                    blockedDates.add(dateStr);
                }
                current.setDate(current.getDate() + 1);
            }
        }
        
        // Also block past dates
        const pastDate = new Date(today);
        pastDate.setDate(pastDate.getDate() - 1);
        const startLoop = new Date(start);
        while (startLoop <= pastDate && startLoop <= end) {
            blockedDates.add(startLoop.toISOString().split('T')[0]);
            startLoop.setDate(startLoop.getDate() + 1);
        }
        
        const blockedArray = Array.from(blockedDates).sort();
        
        // Cache the result
        blockedDatesCache.set(cacheKey, {
            dates: blockedArray,
            timestamp: Date.now()
        });
        
        console.log(`📅 Blocked dates for ${accommodation}: ${blockedArray.length} dates`);
        
        res.json({
            success: true,
            blockedDates: blockedArray,
            accommodation: accommodation,
            startDate: formattedStart,
            endDate: formattedEnd,
            cached: false
        });
        
    } catch (error) {
        console.error('❌ Blocked dates error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch blocked dates.'
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

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => htmlEntities[char]);
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
    // FAIL-CLOSED: If Uplisting is configured, we MUST verify availability
    // to prevent overbookings from external channels (Booking.com, Airbnb, etc.)
    
    if (!process.env.UPLISTING_API_KEY) {
        console.warn('⚠️ Uplisting API key not configured, using local availability only');
        return { available: true, error: null };
    }
    
    try {
        // Use centralized property mapping
        const propertyId = getPropertyIdFromAccommodation(accommodation);
        if (!propertyId) {
            console.error(`❌ No Uplisting property ID configured for ${accommodation} - blocking booking to prevent overbooking`);
            return { 
                available: false, 
                error: 'Property configuration error. Please contact us directly to book.' 
            };
        }
        
        const baseUrl = getUplistingBaseUrl();
        const url = `${baseUrl}/properties/${propertyId}/availability?start_date=${checkIn}&end_date=${checkOut}`;
        console.log('🔍 Checking Uplisting availability:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...getUplistingAuthHeaders(),
                'Content-Type': 'application/json'
            }
        });
        
        console.log('📡 Uplisting API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Uplisting API error:', response.status, errorText);
            // FAIL-CLOSED: Block booking if we can't verify availability
            return { 
                available: false, 
                error: 'Unable to verify availability with our booking system. Please try again later or contact us directly.' 
            };
        }
        
        const data = await response.json();
        console.log('📝 Uplisting availability data:', data);
        return { available: data.available === true, error: null };
        
    } catch (error) {
        console.error('❌ Uplisting availability check failed:', error);
        // FAIL-CLOSED: Block booking if API fails to prevent overbookings
        return { 
            available: false, 
            error: 'Unable to verify availability. Please try again later or contact us directly.' 
        };
    }
}

async function checkAvailability(accommodation, checkIn, checkOut) {
    let localAvailable = true;
    
    try {
        const row = await db.getOne(
            `SELECT COUNT(*) as conflicts 
             FROM bookings 
             WHERE accommodation = $1 
             AND payment_status = 'completed'
             AND (
                 (check_in <= $2 AND check_out > $2) OR
                 (check_in < $3 AND check_out >= $3) OR
                 (check_in >= $2 AND check_out <= $3)
             )`,
            [accommodation, checkIn, checkOut]
        );
        localAvailable = !row || parseInt(row.conflicts) === 0;
        
        if (!localAvailable) {
            return { available: false, error: 'These dates are already booked in our system.' };
        }
        
        // Check Uplisting availability (returns object with available and error properties)
        const uplistingResult = await checkUplistingAvailability(accommodation, checkIn, checkOut);
        return uplistingResult;
        
    } catch (error) {
        console.error('Availability check error:', error);
        // FAIL-CLOSED: If we can't check availability, block the booking
        return { 
            available: false, 
            error: 'Unable to verify availability. Please try again later or contact us directly.' 
        };
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
        
        const baseUrl = getUplistingBaseUrl();
        const response = await fetch(`${baseUrl}/bookings`, {
            method: 'POST',
            headers: {
                ...getUplistingAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(uplistingBooking)
        });
        
        if (response.ok) {
            const uplistingResponse = await response.json();
            console.log('Booking synced to Uplisting:', uplistingResponse.id);
            
            try {
                await db.run(
                    'UPDATE bookings SET uplisting_id = $1, updated_at = NOW() WHERE id = $2',
                    [uplistingResponse.id, bookingData.id]
                );
            } catch (err) {
                console.error('Failed to update Uplisting ID:', err);
            }
        } else {
            console.error('Failed to sync booking to Uplisting:', response.status);
        }
        
    } catch (error) {
        console.error('❌ Uplisting sync error:', error);
    }
}

app.post('/api/uplisting/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        const rawBody = req.body;
        let parsedBody;
        
        try {
            parsedBody = JSON.parse(rawBody.toString());
        } catch (parseErr) {
            console.error('Invalid JSON in Uplisting webhook');
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        
        if (process.env.UPLISTING_WEBHOOK_SECRET) {
            const signature = req.headers['x-uplisting-signature'];
            const expectedSignature = crypto
                .createHmac('sha256', process.env.UPLISTING_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');
            
            if (signature !== expectedSignature) {
                console.error('Invalid Uplisting webhook signature');
                return res.status(400).json({ error: 'Invalid signature' });
            }
        }
        
        const { event, data } = parsedBody;
        
        if (event === 'booking.created' || event === 'booking.updated') {
            // Sanitize external data before storing to prevent stored XSS
            const bookingData = {
                id: `uplisting-${data.id}`,
                guest_name: sanitizeInput(`${data.guest.first_name} ${data.guest.last_name}`.trim()),
                guest_email: sanitizeInput(data.guest.email),
                guest_phone: sanitizeInput(data.guest.phone || ''),
                accommodation: getAccommodationFromPropertyId(data.property_id),
                check_in: data.check_in,
                check_out: data.check_out,
                guests: data.guests,
                total_price: data.total_amount,
                status: data.status === 'confirmed' ? 'confirmed' : 'pending',
                payment_status: data.payment_status || 'completed',
                notes: sanitizeInput(data.notes || 'Booking from Uplisting'),
                uplisting_id: data.id
            };
            
            try {
                await db.run(
                    `INSERT INTO bookings (
                        id, guest_name, guest_email, guest_phone, accommodation,
                        check_in, check_out, guests, total_price, status,
                        payment_status, notes, uplisting_id, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
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
                        updated_at = NOW()`,
                    [
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
                    ]
                );
                console.log('Uplisting booking synced:', data.id);
            } catch (err) {
                console.error('Failed to sync Uplisting booking:', err);
            }
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('Uplisting webhook error:', error);
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
            <p>Dear ${escapeHtml(bookingData.guest_name)},</p>
            <p>Your booking has been confirmed!</p>
            
            <h3>Booking Details:</h3>
            <ul>
                <li><strong>Accommodation:</strong> ${escapeHtml(bookingData.accommodation)}</li>
                <li><strong>Check-in:</strong> ${escapeHtml(bookingData.check_in)}</li>
                <li><strong>Check-out:</strong> ${escapeHtml(bookingData.check_out)}</li>
                <li><strong>Guests:</strong> ${escapeHtml(String(bookingData.guests))}</li>
                <li><strong>Total:</strong> $${escapeHtml(String(bookingData.total_price))} NZD</li>
            </ul>
            
            <p>We look forward to hosting you!</p>
            <p>Best regards,<br>Lakeside Retreat Team</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log('✅ Booking confirmation email sent successfully');
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
        
        // Check availability (returns object with available and error properties)
        const availabilityResult = await checkAvailability(
            sanitizedData.accommodation,
            sanitizedData.check_in,
            sanitizedData.check_out
        );

        console.log('📅 Availability check result:', availabilityResult);

        if (!availabilityResult.available) {
            return res.status(409).json({
                success: false,
                error: availabilityResult.error || 'Selected dates are not available'
            });
        }

        console.log('Creating Stripe checkout session for accommodation:', sanitizedData.accommodation);

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
            success_url: `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`}/booking-cancelled`,
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

        const bookingId = uuidv4();
        console.log('Storing booking with ID:', bookingId);
        
        try {
            await db.run(
                `INSERT INTO bookings (
                    id, guest_name, guest_email, guest_phone, accommodation,
                    check_in, check_out, guests, total_price, status,
                    payment_status, notes, stripe_session_id, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', $10, $11, NOW())`,
                [
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
                ]
            );

            console.log('Booking stored successfully with ID:', bookingId);
            res.json({
                success: true,
                booking_id: bookingId,
                checkout_url: session.url,
                message: 'Booking created successfully'
            });
        } catch (dbErr) {
            console.error('Database error:', dbErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + dbErr.message
            });
        }

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

app.get('/api/booking/:id', async (req, res) => {
    const bookingId = req.params.id;
    
    try {
        const row = await db.getOne(
            `SELECT id, guest_name, accommodation, check_in, check_out, 
                    guests, total_price, status, payment_status, created_at
             FROM bookings 
             WHERE id = $1`,
            [bookingId]
        );
        
        if (!row) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ success: true, booking: row });
    } catch (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
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

// Admin endpoint to sync existing bookings from Uplisting
// Verify Uplisting API key by calling /users/me endpoint
// This is the recommended way to verify API key per Uplisting docs
app.get('/api/admin/uplisting/verify', verifyAdmin, async (req, res) => {
    try {
        if (!process.env.UPLISTING_API_KEY) {
            return res.status(400).json({
                success: false,
                error: 'Uplisting API key not configured',
                configured: false
            });
        }
        
        const baseUrl = getUplistingBaseUrl();
        const verifyUrl = `${baseUrl}/users/me`;
        const authHeaders = getUplistingAuthHeaders();
        
        // Log configuration (without exposing secrets)
        console.log('🔑 Verifying Uplisting API key...');
        console.log(`📍 Base URL: ${baseUrl}`);
        console.log(`🔐 Auth mode: ${process.env.UPLISTING_AUTH_MODE || 'basic'}`);
        
        const response = await fetch(verifyUrl, {
            method: 'GET',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`📡 Uplisting verify response: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Uplisting API key verified successfully');
            return res.json({
                success: true,
                message: 'Uplisting API key is valid',
                configured: true,
                baseUrl: baseUrl,
                authMode: process.env.UPLISTING_AUTH_MODE || 'basic',
                clientId: process.env.UPLISTING_CLIENT_ID ? 'configured' : 'not configured',
                user: data
            });
        } else {
            const errorText = await response.text();
            console.error(`❌ Uplisting API key verification failed: ${response.status}`, errorText);
            return res.status(response.status).json({
                success: false,
                error: `Uplisting API returned ${response.status}`,
                details: errorText,
                configured: true,
                clientId: process.env.UPLISTING_CLIENT_ID ? 'configured' : 'not configured',
                baseUrl: baseUrl,
                authMode: process.env.UPLISTING_AUTH_MODE || 'basic',
                suggestion: response.status === 401 
                    ? 'Check that UPLISTING_API_KEY is from Connect > API Key (not Webhook). Try setting UPLISTING_AUTH_MODE=basic_username if using standard HTTP Basic auth.'
                    : null
            });
        }
    } catch (error) {
        console.error('❌ Uplisting verification error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            configured: !!process.env.UPLISTING_API_KEY
        });
    }
});

// This fetches bookings from Uplisting API and imports them into the local database
app.post('/api/admin/sync-uplisting-bookings', verifyAdmin, async (req, res) => {
    try {
        if (!process.env.UPLISTING_API_KEY) {
            return res.status(400).json({
                success: false,
                error: 'Uplisting API key not configured'
            });
        }
        
        const results = {
            total: 0,
            imported: 0,
            updated: 0,
            errors: [],
            bookings: []
        };
        
        // Get all property IDs
        const propertyMapping = getUplistingPropertyMapping();
        const properties = Object.entries(propertyMapping).filter(([_, id]) => id);
        
        if (properties.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No Uplisting property IDs configured'
            });
        }
        
        console.log('📥 Starting Uplisting bookings sync for properties:', properties.map(p => p[0]));
        
        // Try to fetch bookings from Uplisting API
        // First, try the /bookings endpoint with property filter
        for (const [accommodation, propertyId] of properties) {
            try {
                // Calculate date range: today to 12 months from now
                const today = new Date();
                const endDate = new Date(today);
                endDate.setMonth(endDate.getMonth() + 12);
                
                const startDateStr = today.toISOString().split('T')[0];
                const endDateStr = endDate.toISOString().split('T')[0];
                
                // Try fetching bookings for this property
                // Use the /bookings/:listing_id endpoint (per Uplisting Postman documentation)
                // URL format: https://connect.uplisting.io/bookings/:listing_id?from=YYYY-MM-DD&to=YYYY-MM-DD
                // Requires X-Uplisting-Client-ID header for V2 Partner API (added by getUplistingAuthHeaders)
                const baseUrl = getUplistingBaseUrl();
                const bookingsUrl = `${baseUrl}/bookings/${propertyId}?from=${startDateStr}&to=${endDateStr}`;
                
                console.log(`🔍 Fetching bookings for ${accommodation} from: ${bookingsUrl}`);
                
                const response = await fetch(bookingsUrl, {
                    method: 'GET',
                    headers: {
                        ...getUplistingAuthHeaders(),
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log(`📡 Uplisting API response for ${accommodation}: ${response.status}`);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`📝 Uplisting bookings data for ${accommodation}:`, JSON.stringify(data).substring(0, 500));
                    
                    // Handle different response formats
                    let bookings = [];
                    if (Array.isArray(data)) {
                        bookings = data;
                    } else if (data.data && Array.isArray(data.data)) {
                        bookings = data.data;
                    } else if (data.bookings && Array.isArray(data.bookings)) {
                        bookings = data.bookings;
                    }
                    
                    results.total += bookings.length;
                    
                    for (const booking of bookings) {
                        try {
                            // Extract booking data (handle different API response formats)
                            const bookingData = {
                                id: `uplisting-${booking.id || booking.attributes?.id}`,
                                guest_name: sanitizeInput(
                                    booking.guest?.first_name && booking.guest?.last_name
                                        ? `${booking.guest.first_name} ${booking.guest.last_name}`.trim()
                                        : booking.attributes?.guest_name || 'Guest'
                                ),
                                guest_email: sanitizeInput(booking.guest?.email || booking.attributes?.guest_email || ''),
                                guest_phone: sanitizeInput(booking.guest?.phone || booking.attributes?.guest_phone || ''),
                                accommodation: accommodation,
                                check_in: booking.check_in || booking.attributes?.check_in,
                                check_out: booking.check_out || booking.attributes?.check_out,
                                guests: booking.guests || booking.attributes?.guests || 2,
                                total_price: booking.total_amount || booking.attributes?.total_amount || 0,
                                status: (booking.status || booking.attributes?.status) === 'confirmed' ? 'confirmed' : 'pending',
                                payment_status: booking.payment_status || booking.attributes?.payment_status || 'completed',
                                notes: sanitizeInput(booking.notes || booking.attributes?.notes || 'Synced from Uplisting'),
                                uplisting_id: booking.id || booking.attributes?.id
                            };
                            
                            // Skip if missing required dates
                            if (!bookingData.check_in || !bookingData.check_out) {
                                console.log(`⚠️ Skipping booking ${bookingData.id} - missing dates`);
                                continue;
                            }
                            
                            // Check if booking already exists
                            const existing = await db.getOne(
                                'SELECT id FROM bookings WHERE id = $1 OR uplisting_id = $2',
                                [bookingData.id, bookingData.uplisting_id]
                            );
                            
                            await db.run(
                                `INSERT INTO bookings (
                                    id, guest_name, guest_email, guest_phone, accommodation,
                                    check_in, check_out, guests, total_price, status,
                                    payment_status, notes, uplisting_id, created_at
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
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
                                    updated_at = NOW()`,
                                [
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
                                ]
                            );
                            
                            if (existing) {
                                results.updated++;
                            } else {
                                results.imported++;
                            }
                            
                            results.bookings.push({
                                id: bookingData.id,
                                accommodation: bookingData.accommodation,
                                check_in: bookingData.check_in,
                                check_out: bookingData.check_out,
                                status: existing ? 'updated' : 'imported'
                            });
                            
                        } catch (bookingErr) {
                            console.error(`❌ Error importing booking:`, bookingErr);
                            results.errors.push(`Booking import error: ${bookingErr.message}`);
                        }
                    }
                } else {
                    const errorText = await response.text();
                    console.error(`❌ Uplisting API error for ${accommodation}:`, response.status, errorText);
                    results.errors.push(`${accommodation}: API returned ${response.status} - ${errorText.substring(0, 200)}`);
                }
                
            } catch (propErr) {
                console.error(`❌ Error fetching bookings for ${accommodation}:`, propErr);
                results.errors.push(`${accommodation}: ${propErr.message}`);
            }
        }
        
        // Clear the blocked dates cache so new bookings show immediately
        blockedDatesCache.clear();
        
        console.log(`✅ Uplisting sync complete: ${results.imported} imported, ${results.updated} updated, ${results.errors.length} errors`);
        
        res.json({
            success: true,
            message: `Sync complete: ${results.imported} new bookings imported, ${results.updated} updated`,
            results
        });
        
    } catch (error) {
        console.error('❌ Uplisting sync error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync bookings from Uplisting',
            details: error.message
        });
    }
});

app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    
    try {
        let sql = `
            SELECT id, guest_name, guest_email, guest_phone, accommodation,
                   check_in, check_out, guests, total_price, status,
                   payment_status, created_at, stripe_payment_id, stripe_session_id,
                   uplisting_id, updated_at
            FROM bookings
        `;
        let params = [];
        let paramIndex = 1;
        
        if (status) {
            sql += ` WHERE status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const rows = await db.getAll(sql, params);
        
        let countSql = 'SELECT COUNT(*) as total FROM bookings';
        let countParams = [];
        
        if (status) {
            countSql += ' WHERE status = $1';
            countParams.push(status);
        }
        
        const countRow = await db.getOne(countSql, countParams);
        
        res.json({
            success: true,
            bookings: rows,
            pagination: {
                total: parseInt(countRow.total),
                page: page,
                limit: limit,
                totalPages: Math.ceil(parseInt(countRow.total) / limit)
            }
        });
    } catch (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/booking/:id', verifyAdmin, async (req, res) => {
    const bookingId = req.params.id;
    
    try {
        const row = await db.getOne('SELECT * FROM bookings WHERE id = $1', [bookingId]);
        
        if (!row) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ success: true, booking: row });
    } catch (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/admin/booking/:id/status', verifyAdmin, [
    body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']),
    body('notes').optional().isLength({ max: 500 }).escape()
], async (req, res) => {
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
    
    try {
        let sql = 'UPDATE bookings SET status = $1, updated_at = NOW()';
        let params = [status];
        let paramIndex = 2;
        
        if (notes) {
            sql += `, notes = $${paramIndex++}`;
            params.push(sanitizeInput(notes));
        }
        
        sql += ` WHERE id = $${paramIndex}`;
        params.push(bookingId);
        
        const result = await db.run(sql, params);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({
            success: true,
            message: 'Booking status updated'
        });
    } catch (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/booking/:id', verifyAdmin, async (req, res) => {
    const bookingId = req.params.id;
    
    try {
        const result = await db.run('DELETE FROM bookings WHERE id = $1', [bookingId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({
            success: true,
            message: 'Booking deleted'
        });
    } catch (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const row = await db.getOne(`
            SELECT 
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
                COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
                COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 END) as today_bookings
            FROM bookings
        `);
        
        res.json({
            success: true,
            stats: {
                total_bookings: parseInt(row.total_bookings) || 0,
                pending_bookings: parseInt(row.pending_bookings) || 0,
                confirmed_bookings: parseInt(row.confirmed_bookings) || 0,
                total_revenue: parseFloat(row.total_revenue) || 0,
                today_bookings: parseInt(row.today_bookings) || 0
            }
        });
    } catch (err) {
        console.error('Stats query error:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
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
        
        const baseUrl = getUplistingBaseUrl();
        const response = await fetch(`${baseUrl}/bookings/${bookingId}`, {
            headers: {
                ...getUplistingAuthHeaders(),
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
        
        const booking = await db.getOne('SELECT * FROM bookings WHERE id = $1', [bookingId]);
        
        if (!booking) {
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
        
        const refund = await stripe.refunds.create({
            payment_intent: booking.stripe_payment_id,
            amount: amount ? Math.round(amount * 100) : undefined,
            reason: reason || 'requested_by_customer'
        });
        
        const newStatus = refund.amount === booking.total_price * 100 ? 'cancelled' : 'partially_refunded';
        
        try {
            await db.run(
                'UPDATE bookings SET status = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
                [newStatus, 'refunded', bookingId]
            );
        } catch (updateErr) {
            console.error('Failed to update booking after refund:', updateErr);
        }
        
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
        
    } catch (error) {
        console.error('Refund error:', error);
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
        const baseUrl = getUplistingBaseUrl();
        const response = await fetch(`${baseUrl}/bookings/${uplistingId}/cancel`, {
            method: 'POST',
            headers: {
                ...getUplistingAuthHeaders(),
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

app.post('/api/admin/retry-sync/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const booking = await db.getOne('SELECT * FROM bookings WHERE id = $1', [bookingId]);
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        if (!booking.uplisting_id && booking.payment_status === 'completed') {
            await syncBookingToUplisting(booking);
            
            const updated = await db.getOne('SELECT uplisting_id FROM bookings WHERE id = $1', [bookingId]);
            
            if (updated?.uplisting_id) {
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
        } else {
            res.json({
                success: false,
                error: booking.uplisting_id 
                    ? 'Booking already synced' 
                    : 'Payment not completed'
            });
        }
        
    } catch (error) {
        console.error('Retry sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/admin/booking-stats', verifyAdmin, async (req, res) => {
    try {
        const overview = await db.getOne(`
            SELECT 
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as paid_bookings,
                COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_payments,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
                COUNT(CASE WHEN uplisting_id IS NOT NULL THEN 1 END) as synced_bookings,
                COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue
            FROM bookings
        `);
        
        const recent_bookings = await db.getAll(`
            SELECT 
                id, guest_name, accommodation, check_in, total_price,
                payment_status, status,
                CASE WHEN stripe_session_id IS NOT NULL THEN 'Yes' ELSE 'No' END as stripe_connected,
                CASE WHEN uplisting_id IS NOT NULL THEN 'Yes' ELSE 'No' END as uplisting_synced,
                created_at
            FROM bookings 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        // Normalize numeric values (PostgreSQL returns strings for COUNT/SUM)
        const normalizedOverview = {
            total_bookings: Number(overview.total_bookings) || 0,
            paid_bookings: Number(overview.paid_bookings) || 0,
            pending_payments: Number(overview.pending_payments) || 0,
            cancelled_bookings: Number(overview.cancelled_bookings) || 0,
            synced_bookings: Number(overview.synced_bookings) || 0,
            total_revenue: Number(overview.total_revenue) || 0
        };
        
        res.json({
            success: true,
            stats: {
                overview: normalizedOverview,
                recent_bookings
            }
        });
    } catch (err) {
        console.error('Booking stats error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Accommodation landing pages (SEO-optimized separate pages)
// These routes serve dedicated HTML pages with unique meta tags for each accommodation
app.get('/dome-pinot', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dome-pinot.html'));
});

app.get('/dome-rose', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dome-rose.html'));
});

app.get('/lakeside-cottage', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lakeside-cottage.html'));
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
