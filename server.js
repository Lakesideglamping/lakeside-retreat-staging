const express = require('express');
const path = require('path');
// bcrypt and jwt are used in route modules (admin-auth.js)
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { logger } = require('./logger');
const nodemailer = require('nodemailer');

// Import database abstraction layer (supports both SQLite and PostgreSQL)
const database = require('./database');

// Validate environment variables at startup (see config/env.js)
const config = require('./config/env');
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
        executeDbOperation: executeDbOpUtil, verifyCsrf, generateCsrfToken, initBlacklist,
        verifyAdmin } = require('./middleware/auth');
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
        logger.info('✅ Database initialized successfully');
        if (database.isUsingPostgres()) {
            logger.info('🐘 Using PostgreSQL database');
        } else {
            logger.info('📁 Using SQLite database');
        }
        
        // Run pending database migrations
        try {
            await runMigrations(db, database);
        } catch (err) {
            logger.error('❌ Migration error:', { error: err.message });
            if (process.env.NODE_ENV === 'production') {
                process.exit(1);
            }
        }
        
        // Initialize JWT token blacklist table
        try {
            await initBlacklist();
            logger.info('✅ Token blacklist initialized');
        } catch (err) {
            logger.warn('⚠️ Token blacklist DB init failed, using in-memory only:', { error: err.message });
        }

        // Initialize Uplisting service
        uplisting = new UplistingService({
            apiKey: process.env.UPLISTING_API_KEY,
            getDb: () => db,
            emailNotifications
        });
        if (uplisting.isConfigured) {
            logger.info('🏨 Uplisting service initialized');
            // Periodic calendar reconciliation — re-sync every hour to prevent drift
            setInterval(() => {
                if (uplisting?.isConfigured) {
                    uplisting.reconcileCalendar().catch(err =>
                        logger.error('Calendar reconciliation failed', { error: err.message })
                    );
                }
            }, 60 * 60 * 1000);
        }

        // Initialize marketing automation after database is ready
        try {
            marketingAutomation = new MarketingAutomation(db, emailTransporter);
            await marketingAutomation.initialize();
        } catch (err) {
            logger.warn('⚠️ Marketing automation initialization failed:', { error: err.message });
        }

        // Ensure deposit/security columns exist (idempotent — ignores "already exists" errors)
        const idempotentColumns = [
            `ALTER TABLE bookings ADD COLUMN deposit_release_due TEXT`,
            `ALTER TABLE bookings ADD COLUMN security_deposit_intent_id TEXT`,
            `ALTER TABLE bookings ADD COLUMN security_deposit_status TEXT DEFAULT 'pending'`,
            `ALTER TABLE bookings ADD COLUMN security_deposit_amount DECIMAL(10,2) DEFAULT 300.00`,
            `ALTER TABLE bookings ADD COLUMN security_deposit_released_at TIMESTAMP`,
            `ALTER TABLE bookings ADD COLUMN security_deposit_claimed_amount DECIMAL(10,2) DEFAULT 0`,
        ];
        for (const sql of idempotentColumns) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(sql, (err) => {
                        // Ignore "duplicate column" / "already exists" errors
                        if (err && !err.message.includes('duplicate') && !err.message.includes('already exists')) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            } catch (err) {
                logger.warn('⚠️ Could not add column:', { sql, error: err.message });
            }
        }

        // Sync ADMIN_PASSWORD_HASH env var into database so env var always wins
        if (process.env.ADMIN_PASSWORD_HASH) {
            // Trim whitespace that can sneak in when pasting into dashboard
            process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH.trim();
            try {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO system_settings (setting_key, setting_value)
                         VALUES ('admin_password_hash', ?)
                         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
                        [process.env.ADMIN_PASSWORD_HASH],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } catch (err) {
                logger.warn('⚠️ Could not sync admin password hash to DB:', { error: err.message });
            }
        }

        // Recover any pending deposit releases that were lost due to server restart
        recoverPendingDepositReleases();

        // Check for orphaned payments (Stripe session created but DB never updated to completed)
        checkOrphanedPayments();

        // Retry any unresolved failed webhook events immediately, then every 30 minutes
        retryFailedWebhookEvents();
    })
    .catch(err => {
        logger.error('❌ Failed to initialize database:', { error: err.message });
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
app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'unknown',
    };

    if (!db) {
        health.status = 'degraded';
        health.database = 'not_initialized';
        return res.status(503).json(health);
    }

    try {
        // Run a lightweight query to verify the DB connection is alive
        // Uses the database module's get() which works for both SQLite and PostgreSQL
        await database.get('SELECT 1 AS ok');
        health.database = 'connected';
    } catch (err) {
        logger.error('Health check DB query failed', { error: err.message });
        health.status = 'degraded';
        health.database = 'disconnected';
        return res.status(503).json(health);
    }

    res.json(health);
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
        logger.info('⚠️ DEV_MODE: Stripe webhook received but Stripe not configured');
        return res.status(200).json({ received: true, devMode: true });
    }
    
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        logger.error('Webhook signature verification failed:', { error: err.message });
        return res.status(400).send('Webhook signature verification failed');
    }

    // Delegate to the webhook handler function defined later
    try {
        await handleStripeWebhook(event, res);
    } catch (err) {
        logger.error('[CRITICAL] Unhandled webhook handler error:', { error: err.message, eventId: event.id, eventType: event.type });
        // Return 500 so Stripe retries -- this likely means a Stripe API call failed
        // before the DB update was attempted
        if (!res.headersSent) {
            return res.status(500).send('Webhook handler error');
        }
    }
});

// CRITICAL: Uplisting webhook MUST be defined BEFORE express.json() middleware
// because signature verification requires the raw request body
app.post('/api/uplisting/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        const rawBody = req.body;
        let parsedBody;
        
        try {
            parsedBody = JSON.parse(rawBody.toString());
        } catch (parseErr) {
            logger.error('Invalid JSON in Uplisting webhook');
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        
        // Delegate signature verification to the Uplisting service
        if (uplisting) {
            const signature = req.headers['x-uplisting-signature'];
            const verification = uplisting.verifyWebhookSignature(rawBody, signature);
            if (!verification.valid) {
                logger.error('Invalid Uplisting webhook signature', { reason: verification.reason });
                return res.status(400).json({ error: 'Invalid signature' });
            }

            const result = await uplisting.handleWebhook(parsedBody);
            res.json(result);
        } else {
            logger.warn('⚠️ Uplisting service not initialized yet');
            res.status(503).json({ error: 'Service initializing, please retry' });
        }

    } catch (error) {
        logger.error('Uplisting webhook error:', { error: error.message });
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Webhook processing failed' });
        }
    }
});

// Maintenance mode: serve a "Coming Soon" page for all public requests
// Enable by setting MAINTENANCE_MODE=true in environment variables.
// Health check and webhook endpoints remain accessible for monitoring.
if (process.env.MAINTENANCE_MODE === 'true') {
    app.use((req, res, next) => {
        // Allow health check, webhooks, and static assets needed by maintenance page
        const allowedPaths = ['/api/health', '/api/stripe/webhook', '/api/uplisting/webhook', '/images/', '/maintenance.html'];
        if (allowedPaths.some(p => req.path.startsWith(p))) {
            return next();
        }
        return res.status(503).sendFile(path.join(__dirname, 'public', 'maintenance.html'));
    });
}

// CRITICAL: Gallery image upload MUST be defined BEFORE express.json() middleware
// because base64-encoded images can be up to ~14MB, well above the 10kb global limit.
app.post('/api/admin/gallery/upload',
    express.json({ limit: '15mb' }),
    verifyAdmin,
    verifyCsrf,
    async (req, res) => {
        const { filename, type, data } = req.body || {};

        if (!filename || !type || !data) {
            return res.status(400).json({ success: false, error: 'filename, type, and data are required' });
        }

        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(type.toLowerCase())) {
            return res.status(400).json({ success: false, error: 'Only JPEG, PNG, WebP and GIF images are allowed' });
        }

        const origExt = path.extname(filename).toLowerCase();
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        if (!allowedExts.includes(origExt)) {
            return res.status(400).json({ success: false, error: 'Invalid file extension' });
        }

        // Sanitize filename — strip path traversal, allow only safe characters
        const safeName = path.basename(filename)
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_{2,}/g, '_');

        try {
            // Strip the data URL prefix (data:image/jpeg;base64,...) if present
            const base64Data = data.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // Enforce 10MB limit on actual decoded file size
            if (buffer.length > 10 * 1024 * 1024) {
                return res.status(400).json({ success: false, error: 'Image exceeds 10MB limit' });
            }

            // Convert to WebP and resize to max 1920px on longest side
            const sharpLib = require('sharp');
            const finalName = safeName.replace(/\.[^.]+$/, '.webp');
            const finalPath = path.join(__dirname, 'public', 'images', finalName);

            await sharpLib(buffer)
                .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 85 })
                .toFile(finalPath);

            logger.info('Gallery image uploaded', { filename: finalName });
            res.json({ success: true, filename: finalName, url: `/images/${finalName}` });
        } catch (err) {
            logger.error('Gallery upload error', { error: err.message });
            res.status(500).json({ success: false, error: 'Failed to save image' });
        }
    }
);

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

// ==========================================
// ADMIN PAGE AUTH GUARD
// ==========================================
// Protect admin HTML pages (except admin.html which is the login page).
// Requests for admin-*.html must carry a valid JWT auth token (cookie or header).
// If the token is missing or invalid, redirect to the login page.
const { parseCookies: parseAdminCookies, isTokenBlacklisted: isAdminTokenBlacklisted } = require('./middleware/auth');

app.use(async (req, res, next) => {
    const requestPath = req.path.toLowerCase();
    // Guard all admin pages — admin-*.html plus standalone admin sub-pages
    const adminSubPages = [
        '/add-booking.html', '/edit-booking.html', '/seasonal-rates.html',
        '/system-settings.html', '/review-responses.html', '/backup-system.html',
        '/gallery-management.html'
    ];
    const isAdminPage = (requestPath.startsWith('/admin-') && requestPath.endsWith('.html'))
        || adminSubPages.includes(requestPath);
    if (isAdminPage) {
        try {
            // Extract JWT from Authorization header or httpOnly cookie
            let token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                const cookies = parseAdminCookies(req);
                token = cookies['auth-token'];
            }

            if (!token || await isAdminTokenBlacklisted(token)) {
                return res.redirect('/admin.html');
            }

            const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET, {
                issuer: 'lakeside-retreat',
                audience: 'admin-panel'
            });

            if (decoded.role !== 'admin') {
                return res.redirect('/admin.html');
            }

            // Token is valid — allow the request to continue to express.static
            req.admin = decoded;
            return next();
        } catch (_err) {
            // Invalid or expired token — redirect to login
            return res.redirect('/admin.html');
        }
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
    uplisting: () => uplisting,
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
                    // PostgreSQL COUNT(*) returns bigint as string ('0'), not number (0)
                    // Use Number() to handle both SQLite (number) and PostgreSQL (string)
                    const conflicts = Number(row?.conflicts ?? 0);
                    logger.info(`🔍 Local DB conflict check for ${accommodation}: ${conflicts} conflicts found`);
                    resolve(conflicts === 0);
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
        logger.error('❌ Availability check error:', { error: error.message });
        logger.info('📝 Availability check failed, allowing booking based on local DB only');
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
        logger.warn('⚠️ Email not configured - skipping booking confirmation email');
        logger.debug('📧 Booking confirmation would be sent to:', { email: bookingData.guest_email });
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
            
            <p>Questions? Contact us at info@lakesideretreat.co.nz or +64 21 368 682</p>
            
            <p>Best regards,<br>Stephen &amp; Sandy<br>Lakeside Retreat Team</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        logger.info('✅ Booking confirmation email sent to:', { email: bookingData.guest_email || bookingData.email });
    } catch (error) {
        logger.error('❌ Failed to send booking confirmation:', { error: error.message });
        // Don't throw error - booking should still proceed even if email fails
    }
}

// Send payment confirmation email (after successful payment)
async function sendPaymentConfirmation(bookingData) {
    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        logger.warn('⚠️ Email not configured - skipping payment confirmation email');
        logger.debug('📧 Payment confirmation would be sent to:', { email: bookingData.guest_email });
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
            <strong>Address:</strong> 96 Smiths Way, Mount Pisa, Cromwell</p>
            
            <p><strong>What's Next:</strong></p>
            <ul>
                <li>We'll send detailed check-in instructions 48 hours before your arrival</li>
                <li>If you have any special requests, please reply to this email</li>
                <li>For urgent matters, call us at +64 21 368 682</li>
            </ul>
            
            <p><strong>Looking forward to hosting you at our energy-positive geodesic domes!</strong></p>
            
            <p>Warm regards,<br>
            Stephen &amp; Sandy<br>
            <strong>Lakeside Retreat Team</strong><br>
            +64 21 368 682<br>
            info@lakesideretreat.co.nz</p>
        `
    };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        logger.info('✅ Payment confirmation email sent to:', { email: bookingData.guest_email });
    } catch (error) {
        logger.error('❌ Failed to send payment confirmation:', { error: error.message });
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
        logger.debug(`Webhook event ${event.id} already processed, skipping`);
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
            logger.info('[PAYMENT] Webhook already processed for session:', { sessionId: session.id });
            // Record as processed so future retries are caught by the event-level check above
            db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);
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

            // Create separate payment intent for security deposit authorization hold.
            // If this fails (e.g. card declined for hold), the booking payment is still
            // captured — we mark the booking confirmed without a deposit hold.
            let depositIntent = null;
            try {
                depositIntent = await stripe.paymentIntents.create({
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
            } catch (depositErr) {
                logger.error('[PAYMENT] Security deposit hold failed (booking payment already captured):', {
                    sessionId: session.id,
                    bookingId: session.metadata.bookingId,
                    error: depositErr.message
                });
                // Continue without deposit — booking is still valid
            }

            // Update booking with payment IDs and security deposit status (if deposit succeeded).
            // Match by stripe_session_id first, fall back to booking ID from metadata
            // in case the session ID was not stored during payment session creation.
            try {
                const depositSucceeded = depositIntent !== null;
                const updateSql = `
                    UPDATE bookings
                    SET payment_status = 'completed',
                        status = 'confirmed',
                        stripe_payment_id = ?,
                        stripe_session_id = COALESCE(stripe_session_id, ?),
                        security_deposit_intent_id = ?,
                        security_deposit_status = ?
                    WHERE stripe_session_id = ? OR id = ?
                `;

                await new Promise((resolve, reject) => {
                    db.run(updateSql, [
                        capturedPayment.id, session.id,
                        depositSucceeded ? depositIntent.id : null,
                        depositSucceeded ? 'authorized' : 'failed',
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

                logger.info(`Booking confirmed${depositSucceeded ? ' with security deposit' : ' (deposit hold failed)'} for session:`, { sessionId: session.id });

                // Record successful processing for idempotency
                db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

                // Schedule automatic release of security deposit (only if deposit succeeded)
                if (depositSucceeded) {
                    scheduleDepositRelease(session.metadata.bookingId, depositIntent.id);
                }

                // Post-payment processing (non-critical: sync + email)
                if (verifiedBooking) {
                    // Uplisting sync (tracked separately so retry mechanism can pick up failures)
                    try {
                        await syncBookingToUplisting(verifiedBooking);
                        await database.run(
                            `UPDATE bookings SET uplisting_sync_status = 'synced' WHERE id = ?`,
                            [verifiedBooking.id]
                        );
                    } catch (syncErr) {
                        logger.error('[SYNC] Uplisting sync failed after payment', { bookingId: verifiedBooking.id, error: syncErr.message });
                        // Store failed sync for retry
                        try {
                            await database.run(
                                `UPDATE bookings SET uplisting_sync_status = 'failed' WHERE id = ?`,
                                [verifiedBooking.id]
                            );
                        } catch (dbErr) {
                            logger.error('[SYNC] Failed to mark booking for retry', { bookingId: verifiedBooking.id, error: dbErr.message });
                        }
                    }

                    // Email confirmation (separate try/catch so sync failure doesn't block email)
                    try {
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
                    } catch (emailErr) {
                        logger.error('[PAYMENT] Email confirmation failed:', { error: emailErr.message });
                    }
                }
            } catch (dbErr) {
                // CRITICAL: Payment was captured by Stripe but DB update failed
                logger.error('[CRITICAL] Payment succeeded but DB update failed:', {
                    sessionId: session.id,
                    paymentIntent: capturedPayment?.id,
                    depositIntentId: depositIntent?.id,
                    bookingId: session.metadata.bookingId,
                    error: dbErr.message || String(dbErr)
                });

                sendExternalAlert(
                    'Payment DB Update Failed',
                    `Booking ${session.metadata.bookingId}: payment captured (${capturedPayment?.id}) but DB update failed. Error: ${dbErr.message || String(dbErr)}`,
                    'CRITICAL'
                );

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

                logger.info('Booking confirmed for session:', { sessionId: session.id });

                // Record successful processing for idempotency
                db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

                // Post-payment processing (non-critical: sync + email)
                if (verifiedBooking) {
                    // Uplisting sync (tracked separately so retry mechanism can pick up failures)
                    try {
                        await syncBookingToUplisting(verifiedBooking);
                        await database.run(
                            `UPDATE bookings SET uplisting_sync_status = 'synced' WHERE id = ?`,
                            [verifiedBooking.id]
                        );
                    } catch (syncErr) {
                        logger.error('[SYNC] Uplisting sync failed after payment', { bookingId: verifiedBooking.id, error: syncErr.message });
                        // Store failed sync for retry
                        try {
                            await database.run(
                                `UPDATE bookings SET uplisting_sync_status = 'failed' WHERE id = ?`,
                                [verifiedBooking.id]
                            );
                        } catch (dbErr) {
                            logger.error('[SYNC] Failed to mark booking for retry', { bookingId: verifiedBooking.id, error: dbErr.message });
                        }
                    }

                    // Email confirmation (separate try/catch so sync failure doesn't block email)
                    try {
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
                    } catch (emailErr) {
                        logger.error('[PAYMENT] Email confirmation failed:', { error: emailErr.message });
                    }
                }
            } catch (dbErr) {
                // CRITICAL: Payment completed on Stripe but DB update failed
                logger.error('[CRITICAL] Payment succeeded but DB update failed:', {
                    sessionId: session.id,
                    paymentIntent: session.payment_intent,
                    bookingId: session.metadata.bookingId,
                    error: dbErr.message || String(dbErr)
                });

                sendExternalAlert(
                    'Payment DB Update Failed',
                    `Booking ${session.metadata.bookingId}: payment completed (${session.payment_intent}) but DB update failed. Error: ${dbErr.message || String(dbErr)}`,
                    'CRITICAL'
                );

                // Store failed event for manual recovery
                await logFailedWebhookEvent(event, session, dbErr);

                // Return 500 so Stripe retries the webhook (retries for up to 3 days)
                return res.status(500).json({ error: 'Database update failed' });
            }
        }
    } else if (event.type === 'charge.refunded') {
        const charge = event.data.object;
        const refundAmount = (charge.amount_refunded / 100).toFixed(2);
        try {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE bookings SET payment_status = 'refunded', notes = COALESCE(notes, '') || ? WHERE stripe_payment_id = ?`,
                    [`\n[Refunded: $${refundAmount} NZD - ${new Date().toISOString()}]`, charge.payment_intent],
                    function(err) { if (err) reject(err); else resolve(); }
                );
            });
            logger.info(`[WEBHOOK] Refund recorded: $${refundAmount} for payment ${charge.payment_intent}`);
        } catch (err) {
            logger.error('[WEBHOOK] Failed to record refund:', { error: err.message });
        }
        db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

    } else if (event.type === 'charge.dispute.created') {
        const dispute = event.data.object;
        const disputeAmount = (dispute.amount / 100).toFixed(2);
        logger.warn(`[CHARGEBACK] Dispute created: ${dispute.id}, amount: $${disputeAmount}, reason: ${dispute.reason}`);
        try {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE bookings SET notes = COALESCE(notes, '') || ? WHERE stripe_payment_id = ?`,
                    [`\n[DISPUTE: $${disputeAmount} - ${dispute.reason} - ${new Date().toISOString()}]`, dispute.payment_intent],
                    function(err) { if (err) reject(err); else resolve(); }
                );
            });
        } catch (err) {
            logger.error('[WEBHOOK] Failed to record dispute:', { error: err.message });
        }
        if (emailNotifications) {
            try {
                emailNotifications.sendSystemAlert('Payment Dispute Alert',
                    `A chargeback/dispute has been filed.\nAmount: $${disputeAmount}\nReason: ${dispute.reason}\nDispute ID: ${dispute.id}`
                );
            } catch (emailErr) {
                logger.error('[WEBHOOK] Failed to send dispute alert email:', { error: emailErr.message });
            }
        }
        db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

    } else if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object;
        const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown failure';
        logger.warn(`[WEBHOOK] Payment failed: ${paymentIntent.id}, reason: ${failureMessage}`);
        try {
            const bookingId = paymentIntent.metadata?.bookingId;
            if (bookingId) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE bookings SET payment_status = 'failed', notes = COALESCE(notes, '') || ? WHERE id = ?`,
                        [`\n[Payment failed: ${failureMessage} - ${new Date().toISOString()}]`, bookingId],
                        function(err) { if (err) reject(err); else resolve(); }
                    );
                });

                // Send payment failure notification to guest
                const booking = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });
                if (booking && booking.guest_email && emailNotifications) {
                    try {
                        await emailNotifications.sendPaymentFailureNotification(booking);
                    } catch (emailErr) {
                        logger.error('[WEBHOOK] Failed to send payment failure email:', { error: emailErr.message });
                    }
                }
            }
        } catch (err) {
            logger.error('[WEBHOOK] Failed to record payment failure:', { error: err.message });
        }
        db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

    } else if (event.type === 'checkout.session.expired') {
        const session = event.data.object;
        const bookingId = session.metadata?.bookingId;
        try {
            if (bookingId) {
                const booking = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT id, payment_status FROM bookings WHERE stripe_session_id = ? OR id = ?',
                        [session.id, bookingId],
                        (err, row) => { if (err) reject(err); else resolve(row); }
                    );
                });

                if (booking && booking.payment_status === 'pending') {
                    await new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE bookings SET status = 'cancelled', payment_status = 'expired' WHERE id = ?`,
                            [booking.id],
                            function(err) { if (err) reject(err); else resolve(); }
                        );
                    });
                    logger.info(`[WEBHOOK] Checkout session expired for booking: ${booking.id}`);

                    // Send cancellation confirmation email to guest
                    if (emailNotifications) {
                        try {
                            const fullBooking = await new Promise((resolve, reject) => {
                                db.get('SELECT * FROM bookings WHERE id = ?', [booking.id], (err, row) => {
                                    if (err) reject(err); else resolve(row);
                                });
                            });
                            if (fullBooking?.guest_email) {
                                await emailNotifications.sendCancellationConfirmation(fullBooking);
                            }
                        } catch (emailErr) {
                            logger.error('[WEBHOOK] Failed to send cancellation email:', { error: emailErr.message });
                        }
                    }
                }
            }
        } catch (err) {
            logger.error('[WEBHOOK] Failed to handle expired checkout session:', { error: err.message });
        }
        db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);

    } else {
        // Other events: record as processed
        db.run('INSERT INTO processed_webhook_events (event_id) VALUES (?) ON CONFLICT DO NOTHING', [event.id]);
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
        logger.error('[CRITICAL] Failed webhook event saved to failed_webhook_events table for recovery');
        sendExternalAlert(
            'Failed Webhook Event Logged',
            `Event ${event.id} (${event.type}) for session ${session.id} failed and was saved for recovery. Error: ${(error.message || String(error)).substring(0, 200)}`,
            'CRITICAL'
        );
    } catch (logErr) {
        // Last resort: if even the recovery table write fails, log everything to stdout
        logger.error('[CRITICAL] UNABLE TO WRITE TO RECOVERY TABLE. Manual intervention required.', {
            event_id: event.id,
            event_type: event.type,
            stripe_session_id: session.id,
            stripe_payment_id: session.payment_intent,
            booking_id: session.metadata?.bookingId,
            error: error.message || String(error)
        });
    }
}

/**
 * Send a critical alert to an external webhook (Slack, Discord, etc.).
 * Configured via the ALERT_WEBHOOK_URL environment variable. When not set,
 * this is a silent no-op. Never throws — errors are logged to console.
 * Rate-limited to max 1 alert per 5 minutes per unique title.
 */
const _alertRateMap = new Map();
async function sendExternalAlert(title, message, severity = 'CRITICAL') {
    const webhookUrl = config.alertWebhookUrl;
    if (!webhookUrl) return;

    // Rate limit: skip if the same title was sent within the last 5 minutes
    const now = Date.now();
    const lastSent = _alertRateMap.get(title);
    if (lastSent && (now - lastSent) < 5 * 60 * 1000) {
        return;
    }
    _alertRateMap.set(title, now);

    const severityIcon = severity === 'CRITICAL' ? '\ud83d\udea8' : '\u26a0\ufe0f';
    const text = `${severityIcon} [${severity}] ${title}: ${message}`;

    const payload = JSON.stringify({
        text,
        blocks: [{
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${severityIcon} *[${severity}] ${title}*\n${message}`
            }
        }]
    });

    try {
        const { URL } = require('url');
        const parsedUrl = new URL(webhookUrl);
        const httpModule = require(parsedUrl.protocol === 'https:' ? 'https' : 'http');

        await new Promise((resolve, reject) => {
            const req = httpModule.request(parsedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                timeout: 10000
            }, (res) => {
                res.resume(); // consume response
                resolve();
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Alert webhook timed out')); });
            req.write(payload);
            req.end();
        });
    } catch (err) {
        logger.error('[ALERT] Failed to send external alert:', { error: err.message });
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
            logger.warn(`[STARTUP WARNING] Found ${orphaned.length} potentially orphaned payment(s):`);
            orphaned.forEach(b => {
                logger.warn(`  - Booking ${b.id}: ${b.accommodation}, email: ${b.guest_email}, created: ${b.created_at}`);
            });
            sendExternalAlert(
                'Orphaned Payments Detected',
                `Found ${orphaned.length} booking(s) with Stripe sessions but pending payment status. These may need manual review.`,
                'WARNING'
            );
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
            logger.warn(`[STARTUP WARNING] Found ${unresolved.length} unresolved failed webhook event(s):`);
            unresolved.forEach(e => {
                logger.warn(`  - Event ${e.event_id}: session=${e.stripe_session_id}, booking=${e.booking_id}, created: ${e.created_at}`);
            });
        }
    } catch (err) {
        logger.error('[STARTUP] Failed to check for orphaned payments:', { error: err.message });
    }
}

/**
 * Retry unresolved failed webhook events by re-fetching the Stripe session
 * and completing the booking if the payment was successful. Runs on a schedule
 * (every 30 minutes) to automatically recover from transient DB failures.
 * Limited to 5 retries per run to avoid overwhelming the Stripe API.
 */
async function retryFailedWebhookEvents() {
    if (!stripe || !db) return;

    try {
        const unresolvedEvents = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, event_id, stripe_session_id, booking_id, error_message, retry_count, last_retry_at, created_at
                 FROM failed_webhook_events
                 WHERE resolved = ? AND retry_count < 10
                 ORDER BY created_at ASC
                 LIMIT 5`,
                [database.isUsingPostgres() ? false : 0],
                (err, rows) => { if (err) reject(err); else resolve(rows || []); }
            );
        });

        if (unresolvedEvents.length === 0) return;

        logger.info(`[RETRY] Processing ${unresolvedEvents.length} unresolved failed webhook event(s)...`);

        // Exponential backoff schedule (in minutes): 1m, 2m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 24h
        const BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 180, 360, 720, 1440];

        for (const failedEvent of unresolvedEvents) {
            try {
                // Exponential backoff: skip if not enough time has elapsed
                const retryCount = failedEvent.retry_count || 0;
                const backoffMinutes = BACKOFF_MINUTES[Math.min(retryCount, BACKOFF_MINUTES.length - 1)];
                const lastRetryAt = failedEvent.last_retry_at ? new Date(failedEvent.last_retry_at).getTime() : new Date(failedEvent.created_at).getTime();
                const minutesSinceLastRetry = (Date.now() - lastRetryAt) / 60000;
                if (minutesSinceLastRetry < backoffMinutes) {
                    continue; // Skip, not enough time elapsed
                }

                // Increment retry_count and record last_retry_at for this attempt
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE failed_webhook_events SET retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [failedEvent.id],
                        function(err) { if (err) reject(err); else resolve(); }
                    );
                });
                const currentRetryCount = (failedEvent.retry_count || 0) + 1;

                // Re-fetch the session from Stripe to check its current status
                const session = await stripe.checkout.sessions.retrieve(failedEvent.stripe_session_id);

                if (session.payment_status !== 'paid' && session.status !== 'complete') {
                    logger.info(`[RETRY] Session ${failedEvent.stripe_session_id} is not complete (status: ${session.status}), skipping`);
                    // Check if max retries reached after increment
                    if (currentRetryCount >= 10) {
                        await markFailedEventResolved(failedEvent.id, 'Max retries reached');
                        sendExternalAlert(
                            'Webhook Retry Max Reached',
                            `Event ${failedEvent.event_id} has reached 10 retries without resolution. Session status: ${session.status}. Manual intervention required.`,
                            'CRITICAL'
                        );
                    }
                    continue;
                }

                // Check if the booking's payment_status is still pending
                const booking = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT id, payment_status FROM bookings WHERE id = ? OR stripe_session_id = ?`,
                        [failedEvent.booking_id, failedEvent.stripe_session_id],
                        (err, row) => { if (err) reject(err); else resolve(row); }
                    );
                });

                if (!booking) {
                    logger.warn(`[RETRY] Booking not found for event ${failedEvent.event_id}, marking resolved`);
                    await markFailedEventResolved(failedEvent.id);
                    continue;
                }

                if (booking.payment_status === 'completed') {
                    // Already completed (perhaps by a Stripe retry), just mark resolved
                    logger.info(`[RETRY] Booking ${booking.id} already completed, marking event resolved`);
                    await markFailedEventResolved(failedEvent.id);
                    continue;
                }

                // Update the booking to completed
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE bookings
                         SET payment_status = 'completed', status = 'confirmed',
                             stripe_payment_id = COALESCE(stripe_payment_id, ?),
                             stripe_session_id = COALESCE(stripe_session_id, ?)
                         WHERE id = ?`,
                        [session.payment_intent, session.id, booking.id],
                        function(err) { if (err) reject(err); else resolve(); }
                    );
                });

                // Mark the failed event as resolved
                await markFailedEventResolved(failedEvent.id);

                logger.info(`[RETRY] Successfully recovered booking ${booking.id} from failed event ${failedEvent.event_id}`);

            } catch (retryErr) {
                // Log but don't mark as resolved — it will be retried next cycle
                logger.error(`[RETRY] Failed to recover event ${failedEvent.event_id}:`, { error: retryErr.message });

                // Check if max retries reached after this failed attempt
                const currentRetryCount = (failedEvent.retry_count || 0) + 1;
                if (currentRetryCount >= 10) {
                    try {
                        await markFailedEventResolved(failedEvent.id, 'Max retries reached');
                        sendExternalAlert(
                            'Webhook Retry Max Reached',
                            `Event ${failedEvent.event_id} has reached 10 retries and last attempt failed: ${retryErr.message}. Manual intervention required.`,
                            'CRITICAL'
                        );
                    } catch (markErr) {
                        logger.error(`[RETRY] Failed to mark max-retry event ${failedEvent.event_id}:`, { error: markErr.message });
                    }
                }
            }
        }
    } catch (err) {
        logger.error('[RETRY] Failed to query unresolved webhook events:', { error: err.message });
    }
}

/**
 * Mark a failed webhook event as resolved with the current timestamp.
 * Optionally append a note to the error_message (e.g. 'Max retries reached').
 */
async function markFailedEventResolved(failedEventId, note) {
    const noteSql = note
        ? `, error_message = COALESCE(error_message, '') || ?`
        : '';
    const params = note ? [` [${note}]`, failedEventId] : [failedEventId];
    await new Promise((resolve, reject) => {
        db.run(
            `UPDATE failed_webhook_events
             SET resolved = ${database.isUsingPostgres() ? 'true' : '1'},
                 resolved_at = CURRENT_TIMESTAMP${noteSql}
             WHERE id = ?`,
            params,
            function(err) { if (err) reject(err); else resolve(); }
        );
    });
}

// Security Deposit Management Functions
const MAX_TIMER_DELAY = 24 * 60 * 60 * 1000; // 24 hours - prevent setTimeout 32-bit overflow

function scheduleDepositRelease(bookingId, depositIntentId) {
    // Get booking checkout date to calculate release time
    db.get('SELECT check_out FROM bookings WHERE id = ?', [bookingId], (err, booking) => {
        if (err || !booking) {
            logger.error('❌ Failed to get booking for deposit release:', { error: err?.message });
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
                    logger.error('❌ Failed to persist deposit release date:', { error: updateErr.message });
                }
            }
        );

        if (timeUntilRelease > 0) {
            if (timeUntilRelease > MAX_TIMER_DELAY) {
                // Delay exceeds safe setTimeout limit; schedule a re-check instead
                setTimeout(() => {
                    scheduleDepositRelease(bookingId, depositIntentId);
                }, MAX_TIMER_DELAY);
                logger.info(`⏰ Deposit release for booking ${bookingId} is >24h away (${releaseDate.toLocaleString('en-NZ')}), scheduling re-check`);
            } else {
                setTimeout(async () => {
                    await autoReleaseSecurityDeposit(bookingId, depositIntentId);
                }, timeUntilRelease);
                logger.info(`⏰ Security deposit scheduled for release on: ${releaseDate.toLocaleString('en-NZ')} for booking ${bookingId}`);
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
            logger.error('❌ Failed to recover pending deposit releases:', { error: err.message });
            return;
        }

        if (!rows || rows.length === 0) {
            logger.info('✅ No pending deposit releases to recover');
            return;
        }

        logger.info(`🔄 Recovering ${rows.length} pending deposit release(s)...`);

        for (const booking of rows) {
            const releaseDate = new Date(booking.deposit_release_due);
            const timeUntilRelease = releaseDate.getTime() - Date.now();

            if (timeUntilRelease <= 0) {
                // Release immediately - past due
                logger.info(`⏰ Releasing overdue deposit for booking ${booking.id}`);
                autoReleaseSecurityDeposit(booking.id, booking.security_deposit_intent_id);
            } else if (timeUntilRelease > MAX_TIMER_DELAY) {
                // Cap the timer to avoid 32-bit overflow; re-check later
                setTimeout(() => {
                    scheduleDepositRelease(booking.id, booking.security_deposit_intent_id);
                }, MAX_TIMER_DELAY);
                logger.info(`⏰ Deposit release for booking ${booking.id} is >24h away, scheduling re-check`);
            } else {
                // Re-schedule the timeout
                setTimeout(async () => {
                    await autoReleaseSecurityDeposit(booking.id, booking.security_deposit_intent_id);
                }, timeUntilRelease);
                logger.info(`⏰ Re-scheduled deposit release for booking ${booking.id} at ${releaseDate.toLocaleString('en-NZ')}`);
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
        logger.error('Deposit release poll error:', { error: err.message });
    }
}, 60 * 60 * 1000).unref();

// Retry failed webhook events every 30 minutes (recovers from transient DB failures)
setInterval(async () => {
    try {
        await retryFailedWebhookEvents();
    } catch (err) {
        logger.error('Failed webhook retry poll error:', { error: err.message });
    }
}, 30 * 60 * 1000).unref();

// Calendar reconciliation every 30 minutes (syncs bookings from Uplisting to local DB)
setInterval(async () => {
    try {
        if (uplisting) {
            await uplisting.reconcileCalendar();
        }
    } catch (err) {
        logger.error('Calendar reconciliation poll error:', { error: err.message });
    }
}, 30 * 60 * 1000).unref();

// Retry failed Uplisting syncs every 15 minutes (recovers from transient API failures)
setInterval(async () => {
    try {
        await retryFailedUplistingSyncs();
    } catch (err) {
        logger.error('Uplisting sync retry error:', { error: err.message });
    }
}, 15 * 60 * 1000).unref();

async function retryFailedUplistingSyncs() {
    if (!uplisting || !uplisting.isConfigured) return;
    if (!db) return;

    try {
        const failedBookings = await new Promise((resolve, reject) => {
            const sql = `
                SELECT *
                FROM bookings
                WHERE payment_status = 'completed'
                AND uplisting_id IS NULL
                AND booking_source = 'website'
                ORDER BY created_at DESC
                LIMIT 5
            `;
            db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (failedBookings.length === 0) return;

        logger.info(`[Uplisting Retry] Found ${failedBookings.length} bookings to retry sync`);

        for (const booking of failedBookings) {
            try {
                await syncBookingToUplisting(booking);
                logger.info(`[Uplisting Retry] Successfully synced booking ${booking.id}`);
            } catch (err) {
                logger.error(`[Uplisting Retry] Failed to sync booking ${booking.id}:`, { error: err.message });
            }
        }
    } catch (error) {
        logger.error('[Uplisting Retry] Error querying failed syncs:', { error: error.message });
    }
}

async function autoReleaseSecurityDeposit(bookingId, depositIntentId) {
    if (!stripe) {
        logger.warn('⚠️ Stripe not initialised (DEV_MODE) — skipping deposit release for', { bookingId });
        return;
    }
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
                logger.error('❌ Failed to update security deposit release status:', { error: err?.message });
            } else {
                logger.info(`✅ Security deposit automatically released for booking ${bookingId}`);
                
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
                            logger.error('Post-deposit-release notification error:', { error: asyncErr?.message });
                        }
                    }
                });
            }
        });
        
    } catch (error) {
        logger.error('❌ Failed to auto-release security deposit:', { error: error.message, bookingId });
        
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
    logger.debug('🔧 SW request - Path:', { path: swPath });
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(swPath, (err) => {
        if (err) {
            logger.error('❌ Error serving sw.js:', { error: err?.message });
            res.status(404).send('Service worker not found');
        } else {
            logger.debug('✅ SW served successfully');
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
            logger.error('Error ensuring system_settings table:', { error: err?.message });
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

// SEO: Extensionless routes for all standalone pages
app.get('/stay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stay.html'));
});
app.get('/gallery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});
app.get('/guides', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'guides.html'));
});
app.get('/reviews', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reviews.html'));
});
app.get('/our-story', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'our-story.html'));
});
app.get('/explore', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'explore.html'));
});
app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// SEO: Content pages for long-tail keyword targeting
app.get('/central-otago-wine-trail', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'central-otago-wine-trail.html'));
});
app.get('/couples-retreat-central-otago', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'couples-retreat-central-otago.html'));
});
app.get('/weekend-getaway-queenstown', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'weekend-getaway-queenstown.html'));
});
app.get('/cromwell-activities', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cromwell-activities.html'));
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
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📁 Serving from: ${__dirname}`);
    if (DEV_MODE) {
        logger.warn(`⚠️  DEV_MODE: Running without Stripe - payments will return mock responses`);
    }
    logger.info(`🔑 Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'YES' : 'NO'}`);
    logger.info(`📧 Email configured: ${process.env.EMAIL_USER ? 'YES' : 'NO'}`);
    logger.info(`🏨 Uplisting configured: ${process.env.UPLISTING_API_KEY ? 'YES' : 'NO'}`);
    logger.info(`💾 Backup system: ${process.env.NODE_ENV === 'production' ? 'SCHEDULED' : 'MANUAL'}`);
});

// Register process-level error handlers
setupProcessHandlers(log);

// Register graceful shutdown (SIGTERM/SIGINT → drain connections → close DB → exit)
setupGracefulShutdown(server, db, database);
