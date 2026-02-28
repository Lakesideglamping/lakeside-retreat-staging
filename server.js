const express = require('express');
const path = require('path');
// bcrypt and jwt are used in route modules (admin-auth.js)
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const nodemailer = require('nodemailer');

// Import database abstraction layer (supports both SQLite and PostgreSQL)
const database = require('./database');

// Validate environment variables at startup (see config/env.js)
const { validateEnv } = require('./config/env');
validateEnv();

// Development mode for local testing without Stripe
const DEV_MODE = process.env.NODE_ENV !== 'production' && !process.env.STRIPE_SECRET_KEY;

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const crypto = require('crypto');

// Import monitoring system
const {
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

// Shared configuration modules are used in route modules

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
const { escapeHtml: escapeHtmlUtil,
        executeDbOperation: executeDbOpUtil, verifyCsrf, generateCsrfToken } = require('./middleware/auth');
const { errorMiddleware, setupProcessHandlers, setupGracefulShutdown } = require('./middleware/error-handler');
const { adminActionLimiter, adminDestructiveLimiter } = require('./middleware/rate-limit');

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
            getDb: () => db,
            emailNotifications
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

        // Ensure deposit_release_due column exists (idempotent migration)
        try {
            await new Promise((resolve, reject) => {
                db.run(`ALTER TABLE bookings ADD COLUMN deposit_release_due TEXT`, (err) => {
                    // Ignore "duplicate column" errors - column already exists
                    if (err && !err.message.includes('duplicate') && !err.message.includes('already exists')) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        } catch (err) {
            console.error('⚠️ Could not add deposit_release_due column:', err.message);
        }

        // Recover any pending deposit releases that were lost due to server restart
        recoverPendingDepositReleases();

        // Check for orphaned payments (Stripe session created but DB never updated to completed)
        checkOrphanedPayments();
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

// Initialize email notifications early so it can be passed to route modules
const EmailNotifications = require('./email-notifications');
const emailNotifications = new EmailNotifications(emailTransporter);

// Health check endpoints - MUST be before rate limiting to avoid 429 errors on health checks
// These endpoints are used by Render to verify the service is running
// Health check endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// CSRF token endpoint (used by frontend security manager)
// Generates a signed token, sets it in a secure cookie, and returns it in JSON.
// The frontend must send the token back via the X-CSRF-Token header on mutations.
app.get('/api/csrf-token', (req, res) => {
    const token = generateCsrfToken();

    res.setHeader('Set-Cookie',
        `csrf-token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=3600`
    );
    res.json({ csrfToken: token });
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

// Rate limiters for specific routes are defined in route modules

// CORS middleware (must be before rate limiting so preflight OPTIONS are handled first)
app.use((req, res, next) => {
    const allowedOrigins = [
        'https://lakesideretreat.co.nz',
        'https://www.lakesideretreat.co.nz',
        process.env.PUBLIC_BASE_URL
    ].filter(Boolean);
    if (process.env.NODE_ENV !== 'production') {
        allowedOrigins.push('http://localhost:3000', 'http://localhost:10000');
    }

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
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
        includeSubDomains: true,
        preload: true
    },
    
    // SECURITY: Content Security Policy — hardened in Phase 5
    // Inline event handlers (onclick etc.) removed via data-attribute delegation.
    // 'unsafe-inline' required for script-src because app logic lives in inline <script> blocks.
    // scriptSrcAttr 'none' still blocks inline event handlers (onclick="...").
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://js.stripe.com",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com"
            ],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
            connectSrc: [
                "'self'",
                "https://api.stripe.com",
                "https://www.google-analytics.com",
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
        console.error('[CRITICAL] Unhandled webhook handler error:', err.message);
        console.error('[CRITICAL] Event ID:', event.id, 'Type:', event.type);
        // Return 500 so Stripe retries -- this likely means a Stripe API call failed
        // before the DB update was attempted
        if (!res.headersSent) {
            return res.status(500).send('Webhook handler error');
        }
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
        
        // Verify webhook signature — always required regardless of environment
        if (process.env.UPLISTING_WEBHOOK_SECRET) {
            const signature = req.headers['x-uplisting-signature'];
            const expectedSignature = crypto
                .createHmac('sha256', process.env.UPLISTING_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');

            const sigBuffer = Buffer.from(signature || '');
            const expectedBuffer = Buffer.from(expectedSignature);
            if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
                console.error('Invalid Uplisting webhook signature');
                return res.status(400).json({ error: 'Invalid signature' });
            }
        } else {
            // Webhook secret not configured — log warning and reject unsigned requests
            console.warn('[SECURITY WARNING] UPLISTING_WEBHOOK_SECRET is not set — rejecting unsigned webhook. Set UPLISTING_WEBHOOK_SECRET for webhook handling.');
            return res.status(503).json({ error: 'Webhook secret not configured' });
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

// CSRF protection middleware (double-submit cookie pattern)
// Skips GET/HEAD/OPTIONS and webhook endpoints automatically.
// Must be AFTER body parsing and BEFORE route handlers.
app.use(verifyCsrf);

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
// First: redirect responsive image subdirectories to flat images/ directory
// (Desktop/, MobileLarge/, MobileSmall/, Tablet/ were planned but never populated)
app.use('/images/:subdir(Desktop|MobileLarge|MobileSmall|Tablet)/:filename', (req, res, _next) => {
    res.redirect(301, `/images/${req.params.filename}`);
});

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
            // HTML: short cache so deploys take effect quickly
            res.setHeader('Cache-Control', 'public, max-age=60');
        } else if (filePath.endsWith('.js')) {
            // JS: short cache so deploys take effect quickly
            res.setHeader('Cache-Control', 'public, max-age=60');
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
    database,
    sendBookingConfirmation,
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
    adminDestructiveLimiter,
    emailNotifications
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
    getMarketingAutomation: () => marketingAutomation,
    database
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
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const sql = `
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

            db.get(sql, [accommodation, thirtyMinAgo, checkIn, checkIn, checkOut, checkOut, checkIn, checkOut], (err, row) => {
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
    // Check idempotency
    const existing = await new Promise((resolve, reject) => {
        db.get('SELECT event_id FROM processed_webhook_events WHERE event_id = ?', [event.id], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
    if (existing) {
        console.log(`Webhook event ${event.id} already processed, skipping`);
        return res.json({ received: true });
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Check if this booking was already completed (handles Stripe retries after
        // a previous 500 response where the DB update actually succeeded on a later attempt)
        const alreadyCompleted = await new Promise((resolve, reject) => {
            db.get(
                'SELECT id FROM bookings WHERE (stripe_session_id = ? OR id = ?) AND payment_status = ?',
                [session.id, session.metadata.bookingId, 'completed'],
                (err, row) => { if (err) reject(err); else resolve(row); }
            );
        });
        if (alreadyCompleted) {
            console.log('[PAYMENT] Webhook already processed for session:', session.id, '(booking already completed)');
            // Record as processed so future retries are caught by the event-level check above
            db.run('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)', [event.id]);
            return res.json({ received: true, already_processed: true });
        }

        // Handle payment with security deposit
        if (session.metadata.hasSecurityDeposit === 'true') {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
            const _totalAmount = paymentIntent.amount;
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

            // Update booking with both payment IDs and security deposit status.
            // Match by stripe_session_id first, fall back to booking ID from metadata
            // in case the session ID was not stored during payment session creation.
            try {
                const updateSql = `
                    UPDATE bookings
                    SET payment_status = 'completed',
                        status = 'confirmed',
                        stripe_payment_id = ?,
                        stripe_session_id = COALESCE(stripe_session_id, ?),
                        security_deposit_intent_id = ?,
                        security_deposit_status = 'authorized'
                    WHERE stripe_session_id = ? OR id = ?
                `;

                await new Promise((resolve, reject) => {
                    db.run(updateSql, [
                        capturedPayment.id, session.id, depositIntent.id,
                        session.id, session.metadata.bookingId
                    ], function(err) {
                        if (err) reject(err); else resolve();
                    });
                });

                // Verify the update actually persisted
                const verifiedBooking = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT * FROM bookings WHERE (stripe_session_id = ? OR id = ?) AND payment_status = ?',
                        [session.id, session.metadata.bookingId, 'completed'],
                        (err, row) => { if (err) reject(err); else resolve(row); }
                    );
                });
                if (!verifiedBooking) {
                    throw new Error('DB update verification failed — booking not found or payment_status not updated');
                }

                console.log('Booking confirmed with security deposit for session:', session.id);

                // Record successful processing for idempotency
                db.run('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)', [event.id]);

                // Schedule automatic release of security deposit
                scheduleDepositRelease(session.metadata.bookingId, depositIntent.id);

                // Post-payment processing (non-critical: sync + email)
                if (verifiedBooking) {
                    try {
                        await syncBookingToUplisting(verifiedBooking);
                        await sendPaymentConfirmation({
                            guest_name: session.metadata.guest_name,
                            guest_email: session.metadata.guest_email,
                            accommodation: session.metadata.accommodation,
                            check_in: session.metadata.check_in,
                            check_out: session.metadata.check_out,
                            guests: session.metadata.guests,
                            total_price: (bookingAmount / 100).toFixed(2),
                            security_deposit: (depositAmount / 100).toFixed(2),
                            booking_id: verifiedBooking.id
                        });
                    } catch (asyncErr) {
                        console.error('[PAYMENT] Non-critical post-payment error:', asyncErr.message);
                        // Don't fail the webhook — payment and booking are saved
                    }
                }
            } catch (dbErr) {
                // CRITICAL: Payment was captured by Stripe but DB update failed
                console.error('[CRITICAL] Payment succeeded but DB update failed:', {
                    sessionId: session.id,
                    paymentIntent: capturedPayment?.id,
                    depositIntentId: depositIntent?.id,
                    bookingId: session.metadata.bookingId,
                    error: dbErr.message || String(dbErr)
                });

                // Store failed event for manual recovery
                await logFailedWebhookEvent(event, session, dbErr);

                // Return 500 so Stripe retries the webhook (retries for up to 3 days)
                return res.status(500).json({ error: 'Database update failed' });
            }
        } else {
            // Logic for bookings without security deposit.
            // Match by stripe_session_id first, fall back to booking ID from metadata.
            try {
                const updateSql = `
                    UPDATE bookings
                    SET payment_status = 'completed', status = 'confirmed',
                        stripe_payment_id = ?,
                        stripe_session_id = COALESCE(stripe_session_id, ?)
                    WHERE stripe_session_id = ? OR id = ?
                `;

                await new Promise((resolve, reject) => {
                    db.run(updateSql, [
                        session.payment_intent, session.id,
                        session.id, session.metadata.bookingId
                    ], function(err) {
                        if (err) reject(err); else resolve();
                    });
                });

                // Verify the update actually persisted
                const verifiedBooking = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT * FROM bookings WHERE (stripe_session_id = ? OR id = ?) AND payment_status = ?',
                        [session.id, session.metadata.bookingId, 'completed'],
                        (err, row) => { if (err) reject(err); else resolve(row); }
                    );
                });
                if (!verifiedBooking) {
                    throw new Error('DB update verification failed — booking not found or payment_status not updated');
                }

                console.log('Booking confirmed for session:', session.id);

                // Record successful processing for idempotency
                db.run('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)', [event.id]);

                // Post-payment processing (non-critical: sync + email)
                if (verifiedBooking) {
                    try {
                        await syncBookingToUplisting(verifiedBooking);
                        await sendPaymentConfirmation({
                            guest_name: session.metadata.guest_name,
                            guest_email: session.metadata.guest_email,
                            accommodation: session.metadata.accommodation,
                            check_in: session.metadata.check_in,
                            check_out: session.metadata.check_out,
                            guests: session.metadata.guests,
                            total_price: (session.amount_total / 100).toFixed(2),
                            booking_id: verifiedBooking.id
                        });
                    } catch (asyncErr) {
                        console.error('[PAYMENT] Non-critical post-payment error:', asyncErr.message);
                        // Don't fail the webhook — payment and booking are saved
                    }
                }
            } catch (dbErr) {
                // CRITICAL: Payment completed on Stripe but DB update failed
                console.error('[CRITICAL] Payment succeeded but DB update failed:', {
                    sessionId: session.id,
                    paymentIntent: session.payment_intent,
                    bookingId: session.metadata.bookingId,
                    error: dbErr.message || String(dbErr)
                });

                // Store failed event for manual recovery
                await logFailedWebhookEvent(event, session, dbErr);

                // Return 500 so Stripe retries the webhook (retries for up to 3 days)
                return res.status(500).json({ error: 'Database update failed' });
            }
        }
    } else {
        // Non-checkout events: record as processed
        db.run('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)', [event.id]);
    }

    res.json({ received: true });
}

/**
 * Log a failed webhook event to the failed_webhook_events table for manual recovery.
 * This is called when Stripe payment succeeded but the DB update failed.
 */
async function logFailedWebhookEvent(event, session, error) {
    const insertSql = `
        INSERT INTO failed_webhook_events
            (event_id, event_type, stripe_session_id, stripe_payment_id, booking_id, event_data, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        event.id,
        event.type,
        session.id,
        session.payment_intent || null,
        session.metadata?.bookingId || null,
        JSON.stringify({
            guest_name: session.metadata?.guest_name,
            guest_email: session.metadata?.guest_email,
            accommodation: session.metadata?.accommodation,
            check_in: session.metadata?.check_in,
            check_out: session.metadata?.check_out,
            amount_total: session.amount_total
        }),
        (error.message || String(error)).substring(0, 1000)
    ];

    try {
        await new Promise((resolve, reject) => {
            db.run(insertSql, params, function(err) {
                if (err) reject(err); else resolve();
            });
        });
        console.error('[CRITICAL] Failed webhook event saved to failed_webhook_events table for recovery');
    } catch (logErr) {
        // Last resort: if even the recovery table write fails, log everything to stdout
        console.error('[CRITICAL] UNABLE TO WRITE TO RECOVERY TABLE. Manual intervention required.');
        console.error('[CRITICAL] Recovery data:', JSON.stringify({
            event_id: event.id,
            event_type: event.type,
            stripe_session_id: session.id,
            stripe_payment_id: session.payment_intent,
            booking_id: session.metadata?.bookingId,
            error: error.message || String(error)
        }));
    }
}

/**
 * Check for orphaned payments on startup — bookings where a Stripe session was
 * created but the payment_status never moved to 'completed'. These may indicate
 * webhook failures that were never retried successfully.
 */
async function checkOrphanedPayments() {
    try {
        // Use a JS-computed ISO timestamp for DB-engine compatibility (works with both SQLite and PostgreSQL)
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const orphaned = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, stripe_session_id, guest_email, accommodation, created_at
                 FROM bookings
                 WHERE stripe_session_id IS NOT NULL
                 AND payment_status = 'pending'
                 AND created_at < ?`,
                [thirtyMinAgo],
                (err, rows) => { if (err) reject(err); else resolve(rows || []); }
            );
        });

        if (orphaned.length > 0) {
            console.warn(`[STARTUP WARNING] Found ${orphaned.length} potentially orphaned payment(s):`);
            orphaned.forEach(b => {
                console.warn(`  - Booking ${b.id}: ${b.accommodation}, email: ${b.guest_email}, created: ${b.created_at}`);
            });
        }

        // Also check for unresolved failed webhook events
        const unresolved = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, event_id, stripe_session_id, booking_id, created_at
                 FROM failed_webhook_events
                 WHERE resolved = ?`,
                [database.isUsingPostgres() ? false : 0],
                (err, rows) => { if (err) reject(err); else resolve(rows || []); }
            );
        });

        if (unresolved.length > 0) {
            console.warn(`[STARTUP WARNING] Found ${unresolved.length} unresolved failed webhook event(s):`);
            unresolved.forEach(e => {
                console.warn(`  - Event ${e.event_id}: session=${e.stripe_session_id}, booking=${e.booking_id}, created: ${e.created_at}`);
            });
        }
    } catch (err) {
        console.error('[STARTUP] Failed to check for orphaned payments:', err.message);
    }
}

// Security Deposit Management Functions
const MAX_TIMER_DELAY = 24 * 60 * 60 * 1000; // 24 hours - prevent setTimeout 32-bit overflow

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

        // Persist the scheduled release date in the DB so it survives server restarts
        db.run(
            `UPDATE bookings SET deposit_release_due = ? WHERE id = ?`,
            [releaseDate.toISOString(), bookingId],
            (updateErr) => {
                if (updateErr) {
                    console.error('❌ Failed to persist deposit release date:', updateErr.message);
                }
            }
        );

        if (timeUntilRelease > 0) {
            if (timeUntilRelease > MAX_TIMER_DELAY) {
                // Delay exceeds safe setTimeout limit; schedule a re-check instead
                setTimeout(() => {
                    scheduleDepositRelease(bookingId, depositIntentId);
                }, MAX_TIMER_DELAY);
                console.log(`⏰ Deposit release for booking ${bookingId} is >24h away (${releaseDate.toLocaleString('en-NZ')}), scheduling re-check`);
            } else {
                setTimeout(async () => {
                    await autoReleaseSecurityDeposit(bookingId, depositIntentId);
                }, timeUntilRelease);
                console.log(`⏰ Security deposit scheduled for release on: ${releaseDate.toLocaleString('en-NZ')} for booking ${bookingId}`);
            }
        } else {
            // Release immediately if checkout + 48 hours has already passed
            autoReleaseSecurityDeposit(bookingId, depositIntentId);
        }
    });
}

// Recover any pending deposit releases that were lost due to server restart
function recoverPendingDepositReleases() {
    const sql = `
        SELECT id, security_deposit_intent_id, deposit_release_due
        FROM bookings
        WHERE security_deposit_status = 'authorized'
          AND security_deposit_intent_id IS NOT NULL
          AND deposit_release_due IS NOT NULL
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('❌ Failed to recover pending deposit releases:', err.message);
            return;
        }

        if (!rows || rows.length === 0) {
            console.log('✅ No pending deposit releases to recover');
            return;
        }

        console.log(`🔄 Recovering ${rows.length} pending deposit release(s)...`);

        for (const booking of rows) {
            const releaseDate = new Date(booking.deposit_release_due);
            const timeUntilRelease = releaseDate.getTime() - Date.now();

            if (timeUntilRelease <= 0) {
                // Release immediately - past due
                console.log(`⏰ Releasing overdue deposit for booking ${booking.id}`);
                autoReleaseSecurityDeposit(booking.id, booking.security_deposit_intent_id);
            } else if (timeUntilRelease > MAX_TIMER_DELAY) {
                // Cap the timer to avoid 32-bit overflow; re-check later
                setTimeout(() => {
                    scheduleDepositRelease(booking.id, booking.security_deposit_intent_id);
                }, MAX_TIMER_DELAY);
                console.log(`⏰ Deposit release for booking ${booking.id} is >24h away, scheduling re-check`);
            } else {
                // Re-schedule the timeout
                setTimeout(async () => {
                    await autoReleaseSecurityDeposit(booking.id, booking.security_deposit_intent_id);
                }, timeUntilRelease);
                console.log(`⏰ Re-scheduled deposit release for booking ${booking.id} at ${releaseDate.toLocaleString('en-NZ')}`);
            }
        }
    });
}

// Hourly polling for overdue deposit releases (safety net for timer overflow or missed timers)
setInterval(async () => {
    try {
        const now = new Date().toISOString();
        const overdueDeposits = await new Promise((resolve, reject) => {
            db.all(`SELECT id, security_deposit_intent_id FROM bookings
                    WHERE security_deposit_status = 'authorized'
                    AND deposit_release_due IS NOT NULL
                    AND deposit_release_due <= ?`, [now], (err, rows) => {
                if (err) reject(err); else resolve(rows || []);
            });
        });
        for (const booking of overdueDeposits) {
            await autoReleaseSecurityDeposit(booking.id, booking.security_deposit_intent_id);
        }
    } catch (err) {
        console.error('Deposit release poll error:', err.message);
    }
}, 60 * 60 * 1000).unref();

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
                        try {
                            await emailNotifications.sendSystemAlert('info',
                                `Security deposit automatically released for ${booking.guest_name}`,
                                {
                                    'Booking ID': booking.id,
                                    'Guest': booking.guest_name,
                                    'Accommodation': booking.accommodation,
                                    'Deposit Amount': `$${booking.security_deposit_amount}`,
                                    'Release Date': new Date().toLocaleString('en-NZ')
                                }
                            );
                        } catch (asyncErr) {
                            console.error('Post-deposit-release notification error:', asyncErr);
                        }
                    }
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to auto-release security deposit:', error);
        
        // Send alert to admin about failed release
        await emailNotifications.sendSystemAlert('error',
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
const escapeHtml = escapeHtmlUtil;
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
// IMPORTANT: These must be defined BEFORE the catch-all route

// Initialize backup system
const BackupSystem = require('./backup-system');
const backupSystem = new BackupSystem();

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
// SEO: Extensionless accommodation routes (canonical URLs use no .html)
// ==========================================
app.get('/dome-pinot', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dome-pinot.html'));
});
app.get('/dome-rose', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dome-rose.html'));
});
app.get('/lakeside-cottage', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lakeside-cottage.html'));
});
app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

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

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

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
