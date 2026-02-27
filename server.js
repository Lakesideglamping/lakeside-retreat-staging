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

// Import database abstraction layer (supports both SQLite and PostgreSQL)
const database = require('./database');

// Validate environment variables at startup (see config/env.js)
const { validateEnv } = require('./config/env');
const envConfig = validateEnv();

// Development mode for local testing without Stripe
const DEV_MODE = process.env.NODE_ENV !== 'production' && !process.env.STRIPE_SECRET_KEY;

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Import monitoring system
const { 
    monitor, 
    trackBookingStart, 
    trackBookingStep, 
    trackBookingSuccess, 
    trackBookingFailure,
    log,
    middleware: monitoringMiddleware,
    generateReport,
    getMetrics
} = require('./monitoring-system');

// Import request queuing system
const { bookingQueue, generalQueue, paymentQueue } = require('./request-queue');

// Import caching system
const { accommodationCache, CacheManager } = require('./cache-system');

// Import chatbot service
const ChatbotService = require('./chatbot-service');
const chatbot = new ChatbotService();

// Import marketing automation service
const MarketingAutomation = require('./marketing-automation');
let marketingAutomation = null;

// Import shared configuration modules
const { getPropertyId, getAccommodationName } = require('./config/properties');
const accommodationsConfig = require('./config/accommodations');

// Import Uplisting service (consolidated from server.js + uplisting-*.js files)
const UplistingService = require('./services/uplisting');

// Import migration runner
const { runMigrations } = require('./migrations/runner');

// Import route modules (extracted from this file)
const createPublicRoutes = require('./routes/public');
const createBookingRoutes = require('./routes/bookings');
const createAdminAuthRoutes = require('./routes/admin-auth');
const createAdminBookingRoutes = require('./routes/admin-bookings');
const createAdminOperationsRoutes = require('./routes/admin-operations');
const createAdminSettingsRoutes = require('./routes/admin-settings');
const { verifyAdmin: verifyAdminMiddleware, sendError: sendErrorUtil, sendSuccess: sendSuccessUtil, 
        sanitizeInput: sanitizeInputUtil, escapeHtml: escapeHtmlUtil, ERROR_CODES: ERROR_CODES_SHARED,
        executeDbOperation: executeDbOpUtil } = require('./middleware/auth');
const { errorMiddleware, setupProcessHandlers, setupGracefulShutdown } = require('./middleware/error-handler');
const { adminActionLimiter, adminBurstLimiter, adminDestructiveLimiter } = require('./middleware/rate-limit');
const { verifyLatestBackup } = require('./services/backup-verify');

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy for Render deployment (fixes rate limiting behind proxy)
app.set('trust proxy', 1);

// Database connection - will be initialized asynchronously
let db = null;

// Uplisting service instance (initialized after DB)
let uplisting = null;

// Initialize database (supports both SQLite and PostgreSQL via DATABASE_URL env var)
database.initializeDatabase()
    .then(async dbConnection => {
        db = dbConnection;
        console.log('✅ Database initialized successfully');
        if (database.isUsingPostgres()) {
            console.log('🐘 Using PostgreSQL database');
        } else {
            console.log('📁 Using SQLite database');
        }
        
        // Run pending database migrations
        try {
            await runMigrations(db, database);
        } catch (err) {
            console.error('❌ Migration error:', err.message);
            if (process.env.NODE_ENV === 'production') {
                process.exit(1);
            }
        }
        
        // Initialize Uplisting service
        uplisting = new UplistingService({
            apiKey: process.env.UPLISTING_API_KEY,
            getDb: () => db
        });
        if (uplisting.isConfigured) {
            console.log('🏨 Uplisting service initialized');
        }
        
        // Initialize marketing automation after database is ready
        try {
            marketingAutomation = new MarketingAutomation(db, emailTransporter);
            await marketingAutomation.initialize();
        } catch (err) {
            console.error('⚠️ Marketing automation initialization failed:', err.message);
        }
    })
    .catch(err => {
        console.error('❌ Failed to initialize database:', err.message);
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

// Health check endpoints - MUST be before rate limiting to avoid 429 errors on health checks
// These endpoints are used by Render to verify the service is running
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

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

// Enhanced contact form rate limiter (prevent spam)
const contactLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // limit each IP to 3 contact form submissions per 10 minutes
    message: { error: 'Too many messages sent, please try again in 10 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting
app.use(generalLimiter);

// Enable compression for all responses (60-80% size reduction)
app.use(compression());

// Add monitoring middleware (must be early in the chain)
app.use(monitoringMiddleware());

// Enhanced security headers (safe configuration)
app.use(helmet({
    // SAFE: These headers are very conservative
    xContentTypeOptions: true,        // Prevents MIME sniffing (replaces noSniff)
    xFrameOptions: { action: 'sameorigin' }, // Allows same-origin frames
    xXssProtection: true,             // Basic XSS protection
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // ENHANCED: Additional security headers
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: false,
        preload: false
    },
    
    // SECURITY: Content Security Policy — hardened in Phase 4
    // Note: 'unsafe-inline' still required for 2 small analytics scripts 
    // and 232 inline event handlers in HTML. Full removal requires refactoring
    // all onclick/onchange handlers to addEventListener in app.js (Phase 5 candidate).
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'",  // Required for Clarity + Web Vitals inline scripts
                "https://js.stripe.com",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://www.clarity.ms",
                "https://scripts.clarity.ms"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],  // Required for inline event handlers (onclick etc.)
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
            connectSrc: [
                "'self'",
                "https://api.stripe.com",
                "https://www.google-analytics.com",
                "https://www.clarity.ms",
                "https://connect.uplisting.io"
            ],
            frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],         // Clickjacking protection (replaces X-Frame-Options)
            upgradeInsecureRequests: [],
            workerSrc: ["'self'"],               // Service worker restriction
            manifestSrc: ["'self'"]              // Web manifest restriction
        }
    },
    crossOriginEmbedderPolicy: false, // Don't block embeds
    crossOriginResourcePolicy: false, // Don't block cross-origin resources
    originAgentCluster: false,        // Don't isolate origins
    
    // KEEP PERMISSIVE: Allow all functionality
    permittedCrossDomainPolicies: false,
    
    // Standard safe defaults
    ieNoOpen: true,
    dnsPrefetchControl: { allow: true }  // Allow DNS prefetching for performance
}));

// Additional security headers middleware
app.use((req, res, next) => {
    // X-Frame-Options for extra clickjacking protection
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Hide server information
    res.removeHeader('X-Powered-By');
    next();
});

// CRITICAL: Stripe webhook MUST be defined BEFORE express.json() middleware
// because Stripe signature verification requires the raw request body
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    // Dev mode: skip webhook processing when Stripe is not configured
    if (DEV_MODE || !stripe) {
        console.log('⚠️ DEV_MODE: Stripe webhook received but Stripe not configured');
        return res.status(200).json({ received: true, devMode: true });
    }
    
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook signature verification failed');
    }

    // Delegate to the webhook handler function defined later
    try {
        await handleStripeWebhook(event, res);
    } catch (err) {
        console.error('Webhook handler error:', err.message);
        return res.status(500).send('Webhook handler error');
    }
});

// CRITICAL: Uplisting webhook MUST be defined BEFORE express.json() middleware
// because signature verification requires the raw request body
app.post('/api/uplisting/webhook', express.raw({type: 'application/json'}), (req, res) => {
    try {
        const rawBody = req.body;
        let parsedBody;
        
        try {
            parsedBody = JSON.parse(rawBody.toString());
        } catch (parseErr) {
            console.error('Invalid JSON in Uplisting webhook');
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        
        // Verify webhook signature if secret is configured
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
        } else {
            // In production, require webhook secret
            if (process.env.NODE_ENV === 'production') {
                console.error('UPLISTING_WEBHOOK_SECRET not configured in production');
                return res.status(503).json({ error: 'Webhook not configured' });
            }
        }
        
        // Delegate to the Uplisting service webhook handler
        if (uplisting) {
            uplisting.handleWebhook(parsedBody, res);
        } else {
            console.warn('⚠️ Uplisting service not initialized yet');
            res.json({ received: true, warning: 'Service initializing' });
        }
        
    } catch (error) {
        console.error('Uplisting webhook error:', error.message);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Middleware (AFTER webhook routes that need raw body)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// SECURITY: Block access to sensitive files before static file serving
// This prevents exposure of server code, database, and configuration files
// NOTE: Only block specific known sensitive files, not all .js files (client-side JS is needed)
app.use((req, res, next) => {
    const requestPath = req.path.toLowerCase();
    
    // Block specific sensitive files and directories
    const blockedPaths = [
        // Server-side JavaScript files (exact matches)
        '/server.js',
        '/monitoring-system.js',
        '/request-queue.js',
        '/cache-system.js',
        '/backup-system.js',
        '/email-notifications.js',
        '/get-uplisting-pricing.js',
        '/get-uplisting-properties.js',
        '/eslint.config.js',
        '/chatbot-service.js',
        '/chatbot-knowledge-base.json',
        // Database files
        '/lakeside.db',
        '/lakeside.db-wal',
        '/lakeside.db-shm',
        // Configuration files
        '/package.json',
        '/package-lock.json',
        '/.env',
        '/.gitignore',
        // Documentation
        '/readme.md',
        // Shell scripts
        '/deploy.sh'
    ];
    
    // Block entire directories
    const blockedDirectories = [
        '/node_modules',
        '/.git',
        '/backups',
        '/services',
        '/lakeside-staging'
    ];
    
    // Check if exact path is blocked
    if (blockedPaths.includes(requestPath)) {
        return res.status(404).send('Not found');
    }
    
    // Check if path starts with a blocked directory
    if (blockedDirectories.some(dir => requestPath.startsWith(dir))) {
        return res.status(404).send('Not found');
    }
    
    next();
});

// Enhanced static file serving with proper caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h', // Default cache for most files
    setHeaders: (res, filePath) => {
        // Set specific cache headers for different file types
        if (filePath.includes('/images/')) {
            // Images: cache for 1 year with immutable flag
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('X-Content-Type-Options', 'nosniff');
        } else if (filePath.endsWith('.css')) {
            // CSS: cache for 30 days
            res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else if (filePath.endsWith('.html')) {
            // HTML: shorter cache for dynamic content
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// NOTE: Health check endpoints are defined earlier in the file (before rate limiting)
// to ensure they are not rate limited and Render health checks always succeed


// ==========================================
// MOUNT ROUTE MODULES
// ==========================================
// Route modules receive dependencies via factory functions.
// The db() getter is used because db is initialized asynchronously.
const getDb = () => db;

// Public routes (accommodations, contact, pricing, chatbot, availability, SEO)
app.use(createPublicRoutes({
    db: getDb,
    emailTransporter,
    accommodationCache,
    chatbot,
    getMarketingAutomation: () => marketingAutomation,
    database
}));

// Booking routes (availability, booking creation, payments, booking status)
app.use(createBookingRoutes({
    db: getDb,
    stripe,
    DEV_MODE,
    bookingQueue,
    paymentQueue,
    checkAvailability,
    executeDbOperation: (operation, params) => executeDbOperation(operation, params),
    tracking: { trackBookingStart, trackBookingStep, trackBookingSuccess, trackBookingFailure }
}));

// Admin auth routes (login, verify, 2FA, password change, contact messages, email)
app.use(createAdminAuthRoutes({
    db: getDb,
    emailTransporter
}));

// Admin booking management routes (CRUD, stats, exports, deposits, Uplisting, Stripe)
app.use(createAdminBookingRoutes({
    db: getDb,
    stripe,
    DEV_MODE,
    syncBookingToUplisting: (data) => uplisting ? uplisting.syncBooking(data) : null,
    cancelUplistingBooking: (id) => uplisting ? uplisting.cancelBooking(id) : null,
    sendBookingConfirmation,
    scheduleDepositRelease,
    database,
    adminActionLimiter,
    adminDestructiveLimiter
}));

// Admin operations routes (monitoring, metrics, cache, analytics, notifications, chatbot admin, marketing)
app.use(createAdminOperationsRoutes({
    db: getDb,
    getMetrics,
    generateReport,
    log,
    CacheManager,
    bookingQueue,
    generalQueue,
    paymentQueue,
    chatbot,
    getMarketingAutomation: () => marketingAutomation
}));

// Admin settings routes (seasonal rates, gallery, reviews, pricing, settings, backups)
app.use(createAdminSettingsRoutes({
    db: getDb,
    ensureSystemSettingsTable,
    database
}));

// ==========================================


// validateEmailFormat was removed (dead code - express-validator's isEmail() is used instead)
// See EFFICIENCY_REPORT.md - Issue #3


// Standard error codes


// Helper function to send standardized error responses


// Helper function to send standardized success responses


// Database operation wrapper with retry logic and better error handling


// Enhanced database transaction wrapper


// Uplisting API integration
// Delegates to Uplisting service (see services/uplisting.js)
async function checkUplistingAvailability(accommodation, checkIn, checkOut) {
    return uplisting ? uplisting.checkAvailability(accommodation, checkIn, checkOut) : true;
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
// Delegates to Uplisting service (see services/uplisting.js)
async function syncBookingToUplisting(bookingData) {
    return uplisting ? uplisting.syncBooking(bookingData) : null;
}

// Uplisting webhook handler function (called from route defined before express.json middleware)
// handleUplistingWebhook is now in services/uplisting.js
// getAccommodationFromPropertyId is now in config/properties.js

async function sendBookingConfirmation(bookingData) {
    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('⚠️ Email not configured - skipping booking confirmation email');
        console.log('📧 Booking confirmation would be sent to:', bookingData.guest_email);
        return;
    }

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: bookingData.guest_email,
        subject: 'Booking Request Received - Lakeside Retreat',
        html: `
            <h2>Booking Request Received</h2>
            <p>Dear ${escapeHtml(bookingData.guest_name || bookingData.firstName + ' ' + bookingData.lastName)},</p>
            <p>Thank you for your booking request! We have received your details and will send final confirmation after payment is complete.</p>
            
            <h3>Booking Details:</h3>
            <ul>
                <li><strong>Accommodation:</strong> ${escapeHtml(bookingData.accommodation)}</li>
                <li><strong>Check-in:</strong> ${escapeHtml(bookingData.check_in || bookingData.checkin)}</li>
                <li><strong>Check-out:</strong> ${escapeHtml(bookingData.check_out || bookingData.checkout)}</li>
                <li><strong>Guests:</strong> ${escapeHtml(String(bookingData.guests))}</li>
                <li><strong>Total:</strong> $${escapeHtml(String(bookingData.total_price || bookingData.totalAmount))} NZD</li>
            </ul>
            
            <p><strong>Next Steps:</strong></p>
            <p>Complete your secure payment to confirm your booking. Once payment is processed, you'll receive a final confirmation email with detailed check-in instructions.</p>
            
            <p>Questions? Contact us at info@lakesideretreat.co.nz or +64 27 888 5888</p>
            
            <p>Best regards,<br>Stephen &amp; Sandy<br>Lakeside Retreat Team</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log('✅ Booking confirmation email sent to:', bookingData.guest_email || bookingData.email);
    } catch (error) {
        console.error('❌ Failed to send booking confirmation:', error);
        // Don't throw error - booking should still proceed even if email fails
    }
}

// Send payment confirmation email (after successful payment)
async function sendPaymentConfirmation(bookingData) {
    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('⚠️ Email not configured - skipping payment confirmation email');
        console.log('📧 Payment confirmation would be sent to:', bookingData.guest_email);
        return;
    }

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: bookingData.guest_email,
        subject: 'Payment Confirmed - Your Lakeside Retreat Booking is Confirmed!',
        html: `
            <h2>Booking Confirmed - Payment Received!</h2>
            <p>Dear ${escapeHtml(bookingData.guest_name)},</p>
            <p><strong>Congratulations! Your payment has been successfully processed and your booking is now confirmed.</strong></p>
            
            <h3>Confirmed Booking Details:</h3>
            <ul>
                <li><strong>Booking ID:</strong> ${escapeHtml(bookingData.booking_id)}</li>
                <li><strong>Accommodation:</strong> ${escapeHtml(bookingData.accommodation)}</li>
                <li><strong>Check-in:</strong> ${escapeHtml(bookingData.check_in)}</li>
                <li><strong>Check-out:</strong> ${escapeHtml(bookingData.check_out)}</li>
                <li><strong>Guests:</strong> ${escapeHtml(String(bookingData.guests))}</li>
                <li><strong>Total Paid:</strong> $${escapeHtml(String(bookingData.total_price))} NZD</li>
            </ul>
            
            <h3>Check-in Information:</h3>
            <p><strong>Check-in Time:</strong> 3:00 PM<br>
            <strong>Check-out Time:</strong> 10:00 AM<br>
            <strong>Address:</strong> 123 Lakeside Road, Cromwell, Central Otago</p>
            
            <p><strong>What's Next:</strong></p>
            <ul>
                <li>We'll send detailed check-in instructions 48 hours before your arrival</li>
                <li>If you have any special requests, please reply to this email</li>
                <li>For urgent matters, call us at +64 27 888 5888</li>
            </ul>
            
            <p><strong>Looking forward to hosting you at our energy-positive geodesic domes!</strong></p>
            
            <p>Warm regards,<br>
            Stephen &amp; Sandy<br>
            <strong>Lakeside Retreat Team</strong><br>
            +64 27 888 5888<br>
            info@lakesideretreat.co.nz</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log('✅ Payment confirmation email sent to:', bookingData.guest_email);
    } catch (error) {
        console.error('❌ Failed to send payment confirmation:', error);
    }
}

// Stripe webhook handler function (called from route defined before express.json middleware)
async function handleStripeWebhook(event, res) {
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Handle payment with security deposit
        if (session.metadata.hasSecurityDeposit === 'true') {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
            const totalAmount = paymentIntent.amount;
            const bookingAmount = parseInt(paymentIntent.metadata.booking_amount);
            const depositAmount = parseInt(paymentIntent.metadata.security_deposit_amount);
            
            // Capture only the booking amount, keep deposit as authorization hold
            const capturedPayment = await stripe.paymentIntents.capture(session.payment_intent, {
                amount_to_capture: bookingAmount
            });
            
            // Create separate payment intent for security deposit authorization hold
            const depositIntent = await stripe.paymentIntents.create({
                amount: depositAmount,
                currency: 'nzd',
                payment_method: paymentIntent.payment_method,
                customer: session.customer,
                capture_method: 'manual',
                confirm: true,
                metadata: {
                    bookingId: session.metadata.bookingId,
                    type: 'security_deposit'
                }
            });
            
            // Update booking with both payment IDs and security deposit status
            const sql = `
                UPDATE bookings 
                SET payment_status = 'completed', 
                    status = 'confirmed', 
                    stripe_payment_id = ?,
                    security_deposit_intent_id = ?,
                    security_deposit_status = 'authorized'
                WHERE stripe_session_id = ?
            `;
            
            db.run(sql, [capturedPayment.id, depositIntent.id, session.id], function(err) {
                if (err) {
                    console.error('Failed to update booking status:', err.message);
                } else {
                    console.log('Booking confirmed with security deposit for session:', session.id);
                    
                    // Schedule automatic release of security deposit
                    scheduleDepositRelease(session.metadata.bookingId, depositIntent.id);
                    
                    // Get booking data for sync to Uplisting
                    db.get('SELECT * FROM bookings WHERE stripe_session_id = ?', [session.id], async (err, booking) => {
                        if (!err && booking) {
                            // Sync to Uplisting
                            await syncBookingToUplisting(booking);
                            
                            // Send payment confirmation email
                            await sendPaymentConfirmation({
                                guest_name: session.metadata.guest_name,
                                guest_email: session.metadata.guest_email,
                                accommodation: session.metadata.accommodation,
                                check_in: session.metadata.check_in,
                                check_out: session.metadata.check_out,
                                guests: session.metadata.guests,
                                total_price: (bookingAmount / 100).toFixed(2),
                                security_deposit: (depositAmount / 100).toFixed(2),
                                booking_id: booking.id
                            });
                        }
                    });
                }
            });
        } else {
            // Original logic for bookings without security deposit
            const sql = `
                UPDATE bookings 
                SET payment_status = 'completed', status = 'confirmed', stripe_payment_id = ?
                WHERE stripe_session_id = ?
            `;
            
            db.run(sql, [session.payment_intent, session.id], function(err) {
                if (err) {
                    console.error('Failed to update booking status:', err.message);
                } else {
                    console.log('Booking confirmed for session:', session.id);
                    
                    // Get booking data for sync to Uplisting
                    db.get('SELECT * FROM bookings WHERE stripe_session_id = ?', [session.id], async (err, booking) => {
                        if (!err && booking) {
                            // Sync to Uplisting
                            await syncBookingToUplisting(booking);
                            
                            // Send payment confirmation email
                            await sendPaymentConfirmation({
                                guest_name: session.metadata.guest_name,
                                guest_email: session.metadata.guest_email,
                                accommodation: session.metadata.accommodation,
                                check_in: session.metadata.check_in,
                                check_out: session.metadata.check_out,
                                guests: session.metadata.guests,
                                total_price: (session.amount_total / 100).toFixed(2),
                                booking_id: booking.id
                            });
                        }
                    });
                }
            });
        }
    }

    res.json({received: true});
}

// Security Deposit Management Functions
function scheduleDepositRelease(bookingId, depositIntentId) {
    // Get booking checkout date to calculate release time
    db.get('SELECT check_out FROM bookings WHERE id = ?', [bookingId], (err, booking) => {
        if (err || !booking) {
            console.error('❌ Failed to get booking for deposit release:', err);
            return;
        }
        
        const checkoutDate = new Date(booking.check_out);
        const releaseDate = new Date(checkoutDate.getTime() + (48 * 60 * 60 * 1000)); // 48 hours after checkout
        const now = new Date();
        const timeUntilRelease = releaseDate.getTime() - now.getTime();
        
        if (timeUntilRelease > 0) {
            setTimeout(async () => {
                await autoReleaseSecurityDeposit(bookingId, depositIntentId);
            }, timeUntilRelease);
            
            console.log(`⏰ Security deposit scheduled for release on: ${releaseDate.toLocaleString('en-NZ')} for booking ${bookingId}`);
        } else {
            // Release immediately if checkout + 48 hours has already passed
            autoReleaseSecurityDeposit(bookingId, depositIntentId);
        }
    });
}

async function autoReleaseSecurityDeposit(bookingId, depositIntentId) {
    try {
        // Cancel the authorization hold (releases the funds)
        await stripe.paymentIntents.cancel(depositIntentId);
        
        // Update database
        const sql = `
            UPDATE bookings 
            SET security_deposit_status = 'released', 
                security_deposit_released_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        
        db.run(sql, [bookingId], (err) => {
            if (err) {
                console.error('❌ Failed to update security deposit release status:', err);
            } else {
                console.log(`✅ Security deposit automatically released for booking ${bookingId}`);
                
                // Send notification email to admin
                db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], async (err, booking) => {
                    if (!err && booking) {
                        const EmailNotifications = require('./email-notifications');
                        const emailService = new EmailNotifications();
                        await emailService.sendSystemAlert('info', 
                            `Security deposit automatically released for ${booking.guest_name}`, 
                            {
                                'Booking ID': booking.id,
                                'Guest': booking.guest_name,
                                'Accommodation': booking.accommodation,
                                'Deposit Amount': `$${booking.security_deposit_amount}`,
                                'Release Date': new Date().toLocaleString('en-NZ')
                            }
                        );
                    }
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to auto-release security deposit:', error);
        
        // Send alert to admin about failed release
        const EmailNotifications = require('./email-notifications');
        const emailService = new EmailNotifications();
        await emailService.sendSystemAlert('error', 
            `Failed to auto-release security deposit for booking ${bookingId}`, 
            {
                'Booking ID': bookingId,
                'Deposit Intent ID': depositIntentId,
                'Error': error.message,
                'Action Required': 'Manual release required via admin dashboard'
            }
        );
    }
}

// Admin middleware — use the extracted version from middleware/auth.js
const verifyAdmin = verifyAdminMiddleware;
const sendError = sendErrorUtil;
const sendSuccess = sendSuccessUtil;
const sanitizeInput = sanitizeInputUtil;
const escapeHtml = escapeHtmlUtil;
const ERROR_CODES = ERROR_CODES_SHARED;
const executeDbOperation = executeDbOpUtil;


app.get('/sw.js', (req, res) => {
    const swPath = path.join(__dirname, 'sw.js');
    console.log('🔧 SW request - Path:', swPath);
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(swPath, (err) => {
        if (err) {
            console.error('❌ Error serving sw.js:', err);
            res.status(404).send('Service worker not found');
        } else {
            console.log('✅ SW served successfully');
        }
    });
});

// Enhanced Admin API Endpoints for Stripe/Uplisting Integration

// Add Uplisting dashboard endpoint
const { getUplistingDashboardData } = require('./uplisting-dashboard-api.js');

// IMPORTANT: These must be defined BEFORE the catch-all route

// Cancel Uplisting booking helper
// Delegates to Uplisting service (see services/uplisting.js)
async function cancelUplistingBooking(uplistingId) {
    return uplisting ? uplisting.cancelBooking(uplistingId) : null;
}

// Initialize backup system and email notifications
const BackupSystem = require('./backup-system');
const EmailNotifications = require('./email-notifications');
const backupSystem = new BackupSystem();
const emailNotifications = new EmailNotifications();

// Schedule automated backups
if (process.env.NODE_ENV === 'production') {
    backupSystem.scheduleBackups();
}

// Helper function to ensure system_settings table exists with proper schema
function ensureSystemSettingsTable(callback) {
    // Use PostgreSQL-compatible syntax if using PostgreSQL, otherwise SQLite syntax
    const createTableSql = database.isUsingPostgres() 
        ? `
            CREATE TABLE IF NOT EXISTS system_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                setting_type TEXT DEFAULT 'string',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `
        : `
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                setting_type TEXT DEFAULT 'string',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
    db.run(createTableSql, [], function(err) {
        if (err) {
            console.error('Error ensuring system_settings table:', err);
        }
        callback(err);
    });
}

// ==========================================
// GLOBAL ERROR HANDLER (must be after all routes, before SPA fallback)
// ==========================================
app.use(errorMiddleware);

// ==========================================
// SPA FALLBACK (Must be last route)
// ==========================================
// SEO routes and SPA catch-all moved to routes/public.js
// The catch-all is registered here to ensure it's truly last
const publicRouter = require('./routes/public');
app.get('*', publicRouter({
    db: () => db,
    emailTransporter,
    accommodationCache,
    chatbot,
    getMarketingAutomation: () => marketingAutomation,
    database
}).spaFallback);

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
    if (DEV_MODE) {
        console.log(`⚠️  DEV_MODE: Running without Stripe - payments will return mock responses`);
    }
    console.log(`🔑 Stripe configured:`, process.env.STRIPE_SECRET_KEY ? 'YES' : 'NO');
    console.log(`📧 Email configured:`, process.env.EMAIL_USER ? 'YES' : 'NO');
    console.log(`🏨 Uplisting configured:`, process.env.UPLISTING_API_KEY ? 'YES' : 'NO');
    console.log(`💾 Backup system:`, process.env.NODE_ENV === 'production' ? 'SCHEDULED' : 'MANUAL');
});

// Register process-level error handlers
setupProcessHandlers(log);

// Register graceful shutdown (SIGTERM/SIGINT → drain connections → close DB → exit)
setupGracefulShutdown(server, db, database);
