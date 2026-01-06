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

// Initialize Stripe with error handling
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY environment variable is missing!');
    process.exit(1);
}
if (!process.env.JWT_SECRET) {
    console.error('❌ JWT_SECRET environment variable is missing!');
    process.exit(1);
}
if (!process.env.PUBLIC_BASE_URL) {
    console.warn('⚠️ PUBLIC_BASE_URL not set, using default. Set this for production security.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy for Render deployment (fixes rate limiting behind proxy)
app.set('trust proxy', 1);

// Database connection - will be initialized asynchronously
let db = null;

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
    
    // SECURITY: Content Security Policy enabled with permissive directives
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'",  // Required for inline scripts in HTML
                "https://js.stripe.com",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://www.clarity.ms",
                "https://scripts.clarity.ms"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            connectSrc: [
                "'self'",
                "https://api.stripe.com",
                "https://www.google-analytics.com",
                "https://www.clarity.ms"
            ],
            frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: []
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
        
        // Delegate to the webhook handler function defined later
        handleUplistingWebhook(parsedBody, res);
        
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

// MONITORING ENDPOINTS - Moved after verifyAdmin definition


// Accommodations endpoint (with caching)
app.get('/api/accommodations', 
    accommodationCache.middleware({
        ttl: 600000, // 10 minutes
        keyGenerator: (req) => 'accommodations:all'
    }),
    (req, res) => {
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
    body('email')
        .isEmail()
        .matches(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)
        .normalizeEmail({
            gmail_remove_dots: false,
            gmail_remove_subaddress: false,
            outlookdotcom_remove_subaddress: false,
            yahoo_remove_subaddress: false,
            icloud_remove_subaddress: false
        }),
    body('message').trim().isLength({ min: 10, max: 1000 }).escape(),
    body('subject').optional().trim().isLength({ max: 200 }).escape()
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
    body('guest_phone').optional().custom((value) => {
        if (!value) return true; // Allow empty phone numbers
        // More flexible phone validation - allow international formats
        const phoneRegex = /^[\+]?[\d\s\-\(\)\.]{7,20}$/;
        if (!phoneRegex.test(value)) {
            throw new Error('Please enter a valid phone number (7-20 digits, may include +, spaces, dashes, dots, or parentheses)');
        }
        return true;
    }),
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

function validateEmailFormat(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Standardized error response system
function createErrorResponse(code, message, details = null, requestId = null) {
    const response = {
        success: false,
        error: {
            code: code,
            message: message,
            timestamp: new Date().toISOString(),
            ...(details && { details }),
            ...(requestId && { requestId })
        }
    };
    
    // Add debug info in development
    if (process.env.NODE_ENV === 'development' && details) {
        response.debug = details;
    }
    
    return response;
}

// Standard error codes
const ERROR_CODES = {
    // Validation errors (400)
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
    INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
    
    // Authentication errors (401)
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    INVALID_TOKEN: 'INVALID_TOKEN',
    
    // Authorization errors (403)
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    ADMIN_ACCESS_REQUIRED: 'ADMIN_ACCESS_REQUIRED',
    
    // Not found errors (404)
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
    ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
    
    // Conflict errors (409)
    RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
    DATES_NOT_AVAILABLE: 'DATES_NOT_AVAILABLE',
    BOOKING_ALREADY_EXISTS: 'BOOKING_ALREADY_EXISTS',
    
    // Server errors (500)
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    PAYMENT_ERROR: 'PAYMENT_ERROR',
    EMAIL_ERROR: 'EMAIL_ERROR',
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR'
};

// Helper function to send standardized error responses
function sendError(res, statusCode, errorCode, message, details = null, requestId = null) {
    const errorResponse = createErrorResponse(errorCode, message, details, requestId);
    return res.status(statusCode).json(errorResponse);
}

// Helper function to send standardized success responses
function sendSuccess(res, data = null, message = null, statusCode = 200) {
    const response = {
        success: true,
        timestamp: new Date().toISOString(),
        ...(message && { message }),
        ...(data && { data })
    };
    
    return res.status(statusCode).json(response);
}

// Database operation wrapper with retry logic and better error handling
async function executeDbOperation(operation, params = [], retries = 3) {
    return new Promise((resolve, reject) => {
        const attemptOperation = (attemptsLeft) => {
            const startTime = Date.now();
            
            operation(db, params, (err, result) => {
                const duration = Date.now() - startTime;
                
                // Log slow queries
                if (duration > 1000) {
                    log('WARN', `Slow database operation: ${duration}ms`, {
                        duration,
                        performance: 'slow_query'
                    });
                }
                
                if (err) {
                    // Retry on database busy errors
                    if ((err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') && attemptsLeft > 0) {
                        const retryDelay = Math.random() * 1000 + 500; // 500-1500ms random delay
                        setTimeout(() => attemptOperation(attemptsLeft - 1), retryDelay);
                        return;
                    }
                    
                    log('ERROR', `Database operation failed: ${err.message}`, {
                        error: err.message,
                        code: err.code,
                        duration,
                        retriesLeft: attemptsLeft
                    });
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        };
        
        attemptOperation(retries);
    });
}

// Enhanced database transaction wrapper
async function executeTransaction(operations) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN IMMEDIATE TRANSACTION;', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const executeOperations = async () => {
                    try {
                        const results = [];
                        for (const operation of operations) {
                            const result = await executeDbOperation(operation.query, operation.params, 1);
                            results.push(result);
                        }
                        
                        db.run('COMMIT;', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(results);
                            }
                        });
                    } catch (error) {
                        db.run('ROLLBACK;', () => {
                            reject(error);
                        });
                    }
                };
                
                executeOperations();
            });
        });
    });
}

// Uplisting API integration
async function checkUplistingAvailability(accommodation, checkIn, checkOut) {
    if (!process.env.UPLISTING_API_KEY) {
        console.warn('⚠️ Uplisting API key not configured, using local availability only');
        return true;
    }
    
    try {
        // Map accommodation names to Uplisting property IDs
        const propertyMapping = {
            'dome-pinot': process.env.UPLISTING_PROPERTY_PINOT_ID,
            'dome-rose': process.env.UPLISTING_PROPERTY_ROSE_ID,
            'lakeside-cottage': process.env.UPLISTING_PROPERTY_COTTAGE_ID
        };
        
        const propertyId = propertyMapping[accommodation];
        if (!propertyId) {
            console.warn(`⚠️ No Uplisting property ID configured for ${accommodation}`);
            return true;
        }
        
        const base64ApiKey = Buffer.from(process.env.UPLISTING_API_KEY).toString('base64');
        const url = `https://connect.uplisting.io/properties/${propertyId}/availability?start_date=${checkIn}&end_date=${checkOut}`;
        console.log('🔍 Checking Uplisting availability:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${base64ApiKey}`,
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
        const propertyMapping = {
            'dome-pinot': process.env.UPLISTING_PROPERTY_PINOT_ID,
            'dome-rose': process.env.UPLISTING_PROPERTY_ROSE_ID,
            'lakeside-cottage': process.env.UPLISTING_PROPERTY_COTTAGE_ID
        };
        
        const propertyId = propertyMapping[bookingData.accommodation];
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

// Uplisting webhook handler function (called from route defined before express.json middleware)
function handleUplistingWebhook(parsedBody, res) {
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
                console.error('Failed to sync Uplisting booking:', err.message);
            } else {
                console.log('Uplisting booking synced:', data.id);
            }
        });
    }
    
    res.json({ received: true });
}

// Helper function to map Uplisting property IDs back to accommodation names
function getAccommodationFromPropertyId(propertyId) {
    const propertyMapping = {
        [process.env.UPLISTING_PROPERTY_PINOT_ID]: 'dome-pinot',
        [process.env.UPLISTING_PROPERTY_ROSE_ID]: 'dome-rose',
        [process.env.UPLISTING_PROPERTY_COTTAGE_ID]: 'lakeside-cottage'
    };
    
    return propertyMapping[propertyId] || 'unknown';
}

// Send booking confirmation email
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

// BOOKING ENDPOINTS

// Legacy booking endpoint - redirects to main endpoint for compatibility
app.post('/api/process-booking', bookingLimiter, async (req, res) => {
    console.log('⚠️ Legacy endpoint /api/process-booking called, redirecting to /api/bookings');
    
    // Transform legacy request format to new format
    const legacyData = req.body;
    const newData = {
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
    
    // Forward to main endpoint
    req.body = newData;
    return app._router.handle({ ...req, url: '/api/bookings', method: 'POST' }, res);
});

// Legacy booking endpoint - redirects to main endpoint for compatibility
app.post('/api/create-booking', bookingLimiter, async (req, res) => {
    console.log('⚠️ Legacy endpoint /api/create-booking called, redirecting to /api/bookings');
    return app._router.handle({ ...req, url: '/api/bookings', method: 'POST' }, res);
});

// Consolidated booking endpoint - handles all booking creation (with queuing)
app.post('/api/bookings', 
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
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid booking data', errors.array());
        }

        const {
            accommodation,
            checkin,
            checkout,
            guests,
            petFriendly,
            firstName,
            lastName,
            email,
            phone,
            specialRequests,
            totalAmount
        } = req.body;

        console.log('📝 Processing booking request for:', accommodation);
        
        // Track booking flow start
        trackBookingStart(req.body, req.requestId);
        trackBookingStep('validation', req.requestId, { accommodation });

        // Sanitize inputs
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

        console.log('🔍 Checking availability for dates:', sanitizedData.check_in, 'to', sanitizedData.check_out);
        trackBookingStep('availability_check', req.requestId, { 
            checkIn: sanitizedData.check_in, 
            checkOut: sanitizedData.check_out 
        });

        // Check availability
        const isAvailable = await checkAvailability(
            sanitizedData.accommodation,
            sanitizedData.check_in,
            sanitizedData.check_out
        );

        console.log('📅 Availability check result:', isAvailable);

        if (!isAvailable) {
            return sendError(res, 409, ERROR_CODES.DATES_NOT_AVAILABLE, 'Selected dates are not available');
        }

        // Generate booking ID
        const bookingId = uuidv4();
        console.log('🗄️ Storing booking with ID:', bookingId);

        // Insert booking into database
        const sql = `
            INSERT INTO bookings (
                id, guest_name, guest_email, guest_phone, 
                accommodation, check_in, check_out, guests, 
                total_price, status, payment_status, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, datetime('now'))
        `;

        const booking = await executeDbOperation(
            (database, params, callback) => {
                database.run(sql, params, function(err) {
                    if (err) {
                        callback(err);
                    } else {
                        console.log('✅ Booking stored successfully with ID:', bookingId);
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
                sanitizedData.notes || ''
            ]
        );

        // Track successful booking completion
        trackBookingSuccess(booking.id, req.requestId, booking.total_price);
        trackBookingStep('completion', req.requestId, { 
            bookingId: booking.id, 
            totalAmount: booking.total_price 
        });

        // Send response immediately to client
        const responseData = { booking };
        res.status(201).json({
            success: true,
            timestamp: new Date().toISOString(),
            message: 'Booking created successfully',
            data: responseData
        });

        // Send booking confirmation email asynchronously (after response sent)
        const bookingData = {
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
            payment_status: 'pending',
            notes: sanitizedData.notes
        };

        // Email confirmation will be sent after successful payment via Stripe webhook
        // No need to send email here - booking is still pending payment

    } catch (error) {
        console.error('❌ Booking creation error:', error);
        trackBookingFailure(error, req.requestId, 'unknown');
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to create booking', error.message);
    }
});

// Create Stripe payment session endpoint (with payment queue)
app.post('/api/payments/create-session', 
    paymentQueue.middleware({ queueName: 'payment', priority: 'high' }),
    async (req, res) => {
    try {
        const { bookingId } = req.body;
        
        if (!bookingId) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Booking ID is required');
        }
        
        // Get booking details from database
        const booking = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!booking) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        // Determine if booking has security deposit
        const securityDepositAmount = booking.security_deposit_amount || 350.00; // Default to $350 if not set
        const hasSecurityDeposit = securityDepositAmount > 0;
        
        // Create line items
        const lineItems = [
            {
                price_data: {
                    currency: 'nzd',
                    product_data: {
                        name: `Lakeside Retreat - ${booking.accommodation}`,
                        description: `${booking.check_in} to ${booking.check_out} (${booking.guests} guests)`
                    },
                    unit_amount: Math.round(booking.total_price * 100) // Convert to cents
                },
                quantity: 1
            }
        ];
        
        // Add security deposit line item if applicable
        if (hasSecurityDeposit) {
            lineItems.push({
                price_data: {
                    currency: 'nzd',
                    product_data: {
                        name: 'Security Deposit (Authorization Hold)',
                        description: 'Refundable security deposit - will be released automatically 48 hours after checkout'
                    },
                    unit_amount: Math.round(securityDepositAmount * 100) // Convert to cents
                },
                quantity: 1
            });
        }
        
        // Create Stripe checkout session
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
        
        // Add payment intent data for authorization holds if security deposit exists
        if (hasSecurityDeposit) {
            sessionConfig.payment_intent_data = {
                capture_method: 'manual', // This creates an authorization hold
                metadata: {
                    bookingId: booking.id,
                    booking_amount: Math.round(booking.total_price * 100),
                    security_deposit_amount: Math.round(securityDepositAmount * 100)
                }
            };
        }
        
        const session = await stripe.checkout.sessions.create(sessionConfig);
        
        // Update booking with payment session ID
        await new Promise((resolve, reject) => {
            db.run('UPDATE bookings SET stripe_session_id = ? WHERE id = ?', 
                [session.id, bookingId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({
            sessionId: session.id,
            url: session.url
        });
        
    } catch (error) {
        console.error('❌ Payment session creation error:', error);
        
        // Enhanced Stripe error handling for better UX
        if (error.type === 'StripeCardError') {
            return sendError(res, 400, ERROR_CODES.PAYMENT_ERROR, 'Your card was declined. Please try a different payment method.');
        } else if (error.type === 'StripeRateLimitError') {
            return sendError(res, 429, ERROR_CODES.RATE_LIMIT_ERROR, 'Too many requests. Please try again in a moment.');
        } else if (error.type === 'StripeInvalidRequestError') {
            return sendError(res, 400, ERROR_CODES.PAYMENT_ERROR, 'Invalid payment request. Please check your booking details.');
        } else if (error.type === 'StripeAPIError') {
            return sendError(res, 502, ERROR_CODES.PAYMENT_ERROR, 'Payment service temporarily unavailable. Please try again.');
        } else if (error.type === 'StripeConnectionError') {
            return sendError(res, 503, ERROR_CODES.PAYMENT_ERROR, 'Unable to connect to payment service. Please check your connection.');
        } else if (error.type === 'StripeAuthenticationError') {
            console.error('❌ Stripe authentication error - check API keys');
            return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Payment system configuration error. Please contact support.');
        } else {
            return sendError(res, 500, ERROR_CODES.PAYMENT_ERROR, 'Unable to process payment. Please try again or contact support.');
        }
    }
});

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
            return sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'Database error');
        }
        
        if (!row) {
            return sendError(res, 404, ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found');
        }
        
        res.json({ success: true, booking: row });
    });
});

// Admin login endpoint
app.post('/api/admin/login', adminLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Username and password required');
        }
        
        // Check username
        if (username !== process.env.ADMIN_USERNAME) {
            return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
        }
        
        // Check password against hash
        const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
        if (!isValid) {
            return sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
        }
        
        // Generate JWT token with secure configuration
        const token = jwt.sign(
            { username: username, role: 'admin' },
            process.env.JWT_SECRET,
            { 
                expiresIn: '1h',
                issuer: 'lakeside-retreat',
                audience: 'admin-panel'
            }
        );
        
        // Set secure cookie for token (httpOnly prevents XSS access)
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie('auth-token', token, {
            httpOnly: true,
            secure: isProduction, // HTTPS only in production
            sameSite: 'strict',
            maxAge: 60 * 60 * 1000, // 1 hour
            path: '/admin'
        });
        
        res.json({ 
            success: true, 
            token: token,
            message: 'Login successful'
        });
        
    } catch (error) {
        console.error('Admin login error:', error);
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Login failed');
    }
});

// Admin verification endpoint
app.get('/api/admin/verify', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return sendError(res, 401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'No token provided');
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
            return sendError(res, 401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'No token provided');
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'admin') {
            return sendError(res, 403, ERROR_CODES.ADMIN_ACCESS_REQUIRED, 'Admin access required');
        }
        
        req.admin = decoded;
        next();
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// TWO-FACTOR AUTHENTICATION ENDPOINTS

// Get 2FA status
app.get('/api/admin/2fa/status', verifyAdmin, (req, res) => {
    // Check if 2FA is enabled for the admin user
    db.get('SELECT two_fa_enabled, two_fa_secret FROM admin_users WHERE id = 1', (err, row) => {
        if (err || !row) {
            return res.json({ success: true, enabled: false });
        }
        res.json({ success: true, enabled: !!row.two_fa_enabled });
    });
});

// Setup 2FA - generate secret and QR code
app.post('/api/admin/2fa/setup', verifyAdmin, (req, res) => {
    // Generate a random secret (in production, use speakeasy or similar)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < 16; i++) {
        secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Generate otpauth URL for QR code
    const otpauthUrl = `otpauth://totp/LakesideRetreat:admin?secret=${secret}&issuer=LakesideRetreat`;
    
    // In production, generate actual QR code using qrcode library
    // For now, return the URL that can be used with a QR code generator
    res.json({
        success: true,
        secret: secret,
        otpauthUrl: otpauthUrl,
        qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`
    });
});

// Verify 2FA code and enable
app.post('/api/admin/2fa/verify', verifyAdmin, (req, res) => {
    const { code, secret } = req.body;
    
    if (!code || !secret) {
        return res.status(400).json({ success: false, error: 'Code and secret required' });
    }
    
    // In production, verify TOTP code using speakeasy or similar
    // For now, accept any 6-digit code for demo purposes
    if (code.length !== 6 || !/^\d+$/.test(code)) {
        return res.status(400).json({ success: false, error: 'Invalid code format' });
    }
    
    // Generate recovery codes
    const recoveryCodes = [];
    for (let i = 0; i < 8; i++) {
        let recoveryCode = '';
        for (let j = 0; j < 8; j++) {
            recoveryCode += Math.floor(Math.random() * 10);
            if (j === 3) recoveryCode += '-';
        }
        recoveryCodes.push(recoveryCode);
    }
    
    // Store 2FA secret and recovery codes (in production, hash recovery codes)
    db.run(
        `UPDATE admin_users SET two_fa_enabled = 1, two_fa_secret = ?, recovery_codes = ? WHERE id = 1`,
        [secret, JSON.stringify(recoveryCodes)],
        (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Failed to enable 2FA' });
            }
            res.json({ success: true, recoveryCodes });
        }
    );
});

// Disable 2FA
app.post('/api/admin/2fa/disable', verifyAdmin, (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ success: false, error: 'Verification code required' });
    }
    
    // In production, verify the TOTP code before disabling
    db.run(
        `UPDATE admin_users SET two_fa_enabled = 0, two_fa_secret = NULL, recovery_codes = NULL WHERE id = 1`,
        (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
            }
            res.json({ success: true, message: '2FA disabled' });
        }
    );
});

// Change password endpoint
app.post('/api/admin/change-password', verifyAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Current and new password required' });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    
    try {
        // Get current password hash
        db.get('SELECT password_hash FROM admin_users WHERE id = 1', async (err, row) => {
            if (err || !row) {
                return res.status(500).json({ success: false, error: 'Database error' });
            }
            
            // Verify current password
            const bcrypt = require('bcrypt');
            const validPassword = await bcrypt.compare(currentPassword, row.password_hash);
            
            if (!validPassword) {
                return res.status(401).json({ success: false, error: 'Current password is incorrect' });
            }
            
            // Hash new password
            const newHash = await bcrypt.hash(newPassword, 10);
            
            // Update password
            db.run('UPDATE admin_users SET password_hash = ? WHERE id = 1', [newHash], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Failed to update password' });
                }
                res.json({ success: true, message: 'Password changed successfully' });
            });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Get contact messages for admin inbox
app.get('/api/admin/contact-messages', verifyAdmin, (req, res) => {
    db.all(
        `SELECT id, name, email, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100`,
        (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Database error' });
            }
            res.json({ success: true, messages: rows || [] });
        }
    );
});

// Send email endpoint (placeholder - requires email configuration)
app.post('/api/admin/send-email', verifyAdmin, (req, res) => {
    const { to, subject, body } = req.body;
    
    if (!to || !subject || !body) {
        return res.status(400).json({ success: false, error: 'To, subject, and body required' });
    }
    
    // Check if email is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return res.status(503).json({ 
            success: false, 
            error: 'Email not configured. Please set EMAIL_USER and EMAIL_PASS environment variables.' 
        });
    }
    
    // Send email using existing transporter
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        text: body
    };
    
    emailTransporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Failed to send email' });
        }
        res.json({ success: true, message: 'Email sent successfully' });
    });
});

// MONITORING ENDPOINTS (Admin only)

// Get system metrics (admin only)
app.get('/api/admin/metrics', verifyAdmin, (req, res) => {
    try {
        const metrics = getMetrics();
        res.json({
            success: true,
            metrics: metrics
        });
    } catch (error) {
        log('ERROR', 'Failed to retrieve metrics', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to retrieve metrics');
    }
});

// Generate monitoring report (admin only)
app.get('/api/admin/monitoring-report', verifyAdmin, (req, res) => {
    try {
        const report = generateReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        log('ERROR', 'Failed to generate monitoring report', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to generate report');
    }
});

// Cache statistics (admin only)
app.get('/api/admin/cache-stats', verifyAdmin, (req, res) => {
    try {
        const cacheStats = CacheManager.getAllStats();
        const queueStats = {
            booking: bookingQueue.getStats(),
            general: generalQueue.getStats(),
            payment: paymentQueue.getStats()
        };
        
        res.json({
            success: true,
            cache: cacheStats,
            queues: queueStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log('ERROR', 'Failed to retrieve cache stats', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to retrieve cache statistics');
    }
});

// Clear cache (admin only)
app.post('/api/admin/cache/clear', verifyAdmin, (req, res) => {
    try {
        const cleared = CacheManager.clearAll();
        
        log('INFO', 'Cache cleared by admin', { cleared });
        
        res.json({
            success: true,
            message: 'Cache cleared successfully',
            cleared: cleared
        });
    } catch (error) {
        log('ERROR', 'Failed to clear cache', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to clear cache');
    }
});

// Health check with detailed metrics (admin only)
app.get('/api/admin/health-detailed', verifyAdmin, (req, res) => {
    try {
        const metrics = getMetrics();
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: uptime,
                human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
            },
            memory: {
                used: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
                total: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
                external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`
            },
            performance: {
                totalBookings: metrics.bookings.total,
                conversionRate: `${metrics.bookings.conversionRate}%`,
                averageResponseTime: `${metrics.performance.responseTime.average.toFixed(2)}ms`,
                apiSuccessRate: `${((metrics.performance.apiCalls.successful / metrics.performance.apiCalls.total) * 100).toFixed(2)}%`
            },
            errors: {
                total: metrics.errors.total,
                recent: metrics.errors.byCode
            }
        };
        
        res.json({
            success: true,
            health: health
        });
    } catch (error) {
        log('ERROR', 'Failed to generate detailed health check', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Health check failed');
    }
});

// ADMIN BOOKING MANAGEMENT ENDPOINTS

// Get all bookings (admin only) - Enhanced with search, filters, and Stripe/Uplisting status
app.get('/api/admin/bookings', verifyAdmin, (req, res) => {
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
    
    db.all(sql, params, (err, rows) => {
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
        
        db.get(countSql, countParams, (err, countRow) => {
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
app.get('/api/admin/bookings/export', verifyAdmin, (req, res) => {
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
    
    db.all(sql, params, (err, rows) => {
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
app.get('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    const sql = `
        SELECT * FROM bookings WHERE id = ?
    `;
    
    db.get(sql, [bookingId], (err, row) => {
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
app.delete('/api/admin/booking/:id', verifyAdmin, (req, res) => {
    const bookingId = req.params.id;
    
    db.run('DELETE FROM bookings WHERE id = ?', [bookingId], function(err) {
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
app.get('/api/admin/stats', verifyAdmin, (req, res) => {
    const queries = [
        'SELECT COUNT(*) as total_bookings FROM bookings',
        'SELECT COUNT(*) as pending_bookings FROM bookings WHERE status = "pending"',
        'SELECT COUNT(*) as confirmed_bookings FROM bookings WHERE status = "confirmed"',
        'SELECT SUM(total_price) as total_revenue FROM bookings WHERE payment_status = "completed"',
        'SELECT COUNT(*) as today_bookings FROM bookings WHERE DATE(created_at) = DATE("now")'
    ];
    
    const stats = {};
    let completed = 0;
    
    queries.forEach((query, index) => {
        db.get(query, (err, row) => {
            if (err) {
                console.error('Stats query error:', err);
            } else {
                Object.assign(stats, row);
            }
            
            completed++;
            if (completed === queries.length) {
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
            }
        });
    });
});

// Serve static files with proper MIME types
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

app.get('/api/admin/uplisting-dashboard', verifyAdmin, async (req, res) => {
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

// Notifications summary endpoint for admin dashboard
app.get('/api/admin/notifications', verifyAdmin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    const queries = {
        // Critical: Failed payments
        failedPayments: `SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'failed'`,
        // Critical: Sync failures (paid but not synced to Uplisting)
        syncFailures: `SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'completed' AND uplisting_id IS NULL`,
        // Warning: Abandoned checkouts (from marketing automation table)
        abandonedCheckouts: `SELECT COUNT(*) as count FROM abandoned_checkout_reminders WHERE reminder_count < 2`,
        // Pending: Pending bookings awaiting payment
        pendingBookings: `SELECT COUNT(*) as count FROM bookings WHERE status = 'pending' AND payment_status = 'pending'`,
        // Pending: Today's check-ins
        todayCheckins: `SELECT COUNT(*) as count FROM bookings WHERE check_in = ? AND status = 'confirmed'`,
        // Pending: Today's check-outs
        todayCheckouts: `SELECT COUNT(*) as count FROM bookings WHERE check_out = ? AND status = 'confirmed'`,
        // Resolved: Recent confirmed bookings (last 24 hours)
        recentConfirmed: `SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed' AND payment_status = 'completed' AND created_at >= datetime('now', '-1 day')`
    };
    
    const results = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;
    
    const runQuery = (key, sql, params = []) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                results[key] = 0;
            } else {
                results[key] = row ? row.count : 0;
            }
            completed++;
            
            if (completed === totalQueries) {
                // Calculate totals
                const critical = results.failedPayments + results.syncFailures;
                const warnings = results.abandonedCheckouts;
                const pending = results.pendingBookings + results.todayCheckins + results.todayCheckouts;
                const resolved = results.recentConfirmed;
                
                res.json({
                    success: true,
                    summary: {
                        critical,
                        warnings,
                        pending,
                        resolved
                    },
                    details: results
                });
            }
        });
    };
    
    runQuery('failedPayments', queries.failedPayments);
    runQuery('syncFailures', queries.syncFailures);
    runQuery('abandonedCheckouts', queries.abandonedCheckouts);
    runQuery('pendingBookings', queries.pendingBookings);
    runQuery('todayCheckins', queries.todayCheckins, [today]);
    runQuery('todayCheckouts', queries.todayCheckouts, [today]);
    runQuery('recentConfirmed', queries.recentConfirmed);
});

// Analytics endpoint for admin dashboard
app.get('/api/admin/analytics', verifyAdmin, (req, res) => {
    const dateRange = req.query.dateRange || 'month';
    let dateCondition = '';
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (dateRange) {
        case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case 'quarter':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        case 'year':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    dateCondition = `WHERE created_at >= datetime('${startDate.toISOString()}')`;
    
    const analytics = {};
    
    // Get booking analytics
    db.get(
        `SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as paid_bookings,
            SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue,
            AVG(CASE WHEN payment_status = 'completed' THEN total_price END) as avg_booking_value,
            COUNT(DISTINCT accommodation) as accommodations_booked
        FROM bookings ${dateCondition}`,
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            analytics.summary = row;
            
            // Get booking trends by month
            db.all(
                `SELECT 
                    strftime('%Y-%m', created_at) as month,
                    COUNT(*) as bookings,
                    SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue
                FROM bookings ${dateCondition}
                GROUP BY strftime('%Y-%m', created_at)
                ORDER BY month DESC`,
                (err, trends) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    analytics.trends = trends;
                    
                    // Get accommodation performance
                    db.all(
                        `SELECT 
                            accommodation,
                            COUNT(*) as bookings,
                            SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue,
                            AVG(CASE WHEN payment_status = 'completed' THEN total_price END) as avg_price
                        FROM bookings ${dateCondition}
                        GROUP BY accommodation
                        ORDER BY revenue DESC`,
                        (err, accommodations) => {
                            if (err) {
                                return res.status(500).json({ success: false, error: err.message });
                            }
                            
                            analytics.accommodations = accommodations;
                            
                            res.json({
                                success: true,
                                dateRange: dateRange,
                                analytics: analytics
                            });
                        }
                    );
                }
            );
        }
    );
});

// Initialize backup system and email notifications
const BackupSystem = require('./backup-system');
const EmailNotifications = require('./email-notifications');
const backupSystem = new BackupSystem();
const emailNotifications = new EmailNotifications();

// SECURITY DEPOSIT ADMIN ENDPOINTS (Must be after verifyAdmin definition)
// Admin endpoint to manually claim security deposit
app.post('/api/admin/claim-deposit/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, reason } = req.body;
        
        if (!amount || !reason) {
            return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Amount and reason are required');
        }
        
        // Get booking details
        const booking = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
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
            db.run(sql, [parseFloat(amount), bookingId], (err) => {
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
app.post('/api/admin/release-deposit/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // Get booking details
        const booking = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, row) => {
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
            db.run(sql, [bookingId], (err) => {
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

// Schedule automated backups
if (process.env.NODE_ENV === 'production') {
    backupSystem.scheduleBackups();
}

// ============================================
// CHATBOT API ENDPOINTS
// ============================================

// Rate limiter for chatbot (prevent abuse)
const chatbotLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // 20 messages per minute per IP
    message: { error: 'Too many messages, please slow down' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Public chatbot endpoint - answers questions about the website
app.post('/api/chatbot/message', chatbotLimiter, async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                success: false, 
                error: 'Message is required' 
            });
        }
        
        // Sanitize input
        const sanitizedMessage = sanitizeInput(message.substring(0, 1000));
        const session = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result = await chatbot.processMessage(session, sanitizedMessage);
        
        res.json({
            success: result.success,
            response: result.response,
            sessionId: session,
            source: result.source,
            aiEnabled: result.aiEnabled
        });
        
    } catch (error) {
        console.error('Chatbot error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process message',
            response: 'Sorry, I\'m having trouble right now. Please contact us directly at info@lakesideretreat.co.nz or +64-21-368-682.'
        });
    }
});

// Admin endpoint - generate email reply drafts
app.post('/api/admin/chatbot/email-reply', verifyAdmin, async (req, res) => {
    try {
        const { emailContent, guestName, bookingId } = req.body;
        
        if (!emailContent || typeof emailContent !== 'string') {
            return res.status(400).json({ 
                success: false, 
                error: 'Email content is required' 
            });
        }
        
        const result = await chatbot.generateEmailReply(emailContent, {
            guestName: guestName,
            bookingId: bookingId
        });
        
        res.json({
            success: result.success,
            suggestedReply: result.suggestedReply,
            source: result.source
        });
        
    } catch (error) {
        console.error('Email reply generation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate email reply' 
        });
    }
});

// Admin endpoint - get chatbot status
app.get('/api/admin/chatbot/status', verifyAdmin, (req, res) => {
    res.json({
        success: true,
        aiEnabled: chatbot.aiEnabled,
        knowledgeBaseLoaded: !!chatbot.knowledgeBase,
        activeSessions: chatbot.conversationHistory.size
    });
});

// Clear chatbot session (optional cleanup)
app.post('/api/chatbot/clear-session', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
        chatbot.clearSession(sessionId);
    }
    res.json({ success: true });
});

// ==========================================
// MARKETING AUTOMATION ENDPOINTS
// ==========================================

// Public endpoint - Get availability calendar for an accommodation
app.get('/api/availability-calendar', async (req, res) => {
    try {
        const { accommodation, month } = req.query;
        
        if (!accommodation || !month) {
            return res.status(400).json({ 
                success: false, 
                error: 'accommodation and month parameters are required' 
            });
        }
        
        // Validate month format (YYYY-MM)
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ 
                success: false, 
                error: 'month must be in YYYY-MM format' 
            });
        }
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const calendar = await marketingAutomation.getAvailabilityCalendar(accommodation, month);
        res.json({ success: true, ...calendar });
    } catch (error) {
        console.error('Error getting availability calendar:', error);
        res.status(500).json({ success: false, error: 'Failed to get availability calendar' });
    }
});

// Public endpoint - Get next available weekends
app.get('/api/availability-weekends', async (req, res) => {
    try {
        const { accommodation, count } = req.query;
        
        if (!accommodation) {
            return res.status(400).json({ 
                success: false, 
                error: 'accommodation parameter is required' 
            });
        }
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const weekends = await marketingAutomation.getNextAvailableWeekends(
            accommodation, 
            parseInt(count) || 4
        );
        res.json({ success: true, weekends });
    } catch (error) {
        console.error('Error getting available weekends:', error);
        res.status(500).json({ success: false, error: 'Failed to get available weekends' });
    }
});

// Admin endpoint - Get marketing stats
app.get('/api/admin/marketing/stats', verifyAdmin, async (req, res) => {
    try {
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const stats = await marketingAutomation.getMarketingStats();
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error getting marketing stats:', error);
        res.status(500).json({ success: false, error: 'Failed to get marketing stats' });
    }
});

// Admin endpoint - Get abandoned checkouts
app.get('/api/admin/marketing/abandoned-checkouts', verifyAdmin, async (req, res) => {
    try {
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const abandonedCheckouts = await marketingAutomation.getAbandonedCheckouts();
        res.json({ success: true, abandonedCheckouts });
    } catch (error) {
        console.error('Error getting abandoned checkouts:', error);
        res.status(500).json({ success: false, error: 'Failed to get abandoned checkouts' });
    }
});

// Admin endpoint - Send abandoned checkout reminder
app.post('/api/admin/marketing/send-reminder/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const result = await marketingAutomation.sendManualReminder(bookingId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error sending reminder:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to send reminder' });
    }
});

// Admin endpoint - Run abandoned checkout check manually
app.post('/api/admin/marketing/run-abandoned-check', verifyAdmin, async (req, res) => {
    try {
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.processAbandonedCheckouts();
        res.json({ success: true, message: 'Abandoned checkout check completed' });
    } catch (error) {
        console.error('Error running abandoned check:', error);
        res.status(500).json({ success: false, error: 'Failed to run abandoned check' });
    }
});

// Admin endpoint - Get review requests
app.get('/api/admin/marketing/review-requests', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const reviewRequests = await marketingAutomation.getReviewRequests(status);
        res.json({ success: true, reviewRequests });
    } catch (error) {
        console.error('Error getting review requests:', error);
        res.status(500).json({ success: false, error: 'Failed to get review requests' });
    }
});

// Admin endpoint - Send review request manually
app.post('/api/admin/marketing/send-review-request/:bookingId', verifyAdmin, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const result = await marketingAutomation.sendManualReviewRequest(bookingId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error sending review request:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to send review request' });
    }
});

// Admin endpoint - Run review request check manually
app.post('/api/admin/marketing/run-review-check', verifyAdmin, async (req, res) => {
    try {
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.processReviewRequests();
        res.json({ success: true, message: 'Review request check completed' });
    } catch (error) {
        console.error('Error running review check:', error);
        res.status(500).json({ success: false, error: 'Failed to run review check' });
    }
});

// Admin endpoint - Generate social content
app.post('/api/admin/marketing/generate-social', verifyAdmin, async (req, res) => {
    try {
        const { platform, tone, sourceText, accommodation, saveDraft } = req.body;
        
        if (!platform || !tone) {
            return res.status(400).json({ 
                success: false, 
                error: 'platform and tone are required' 
            });
        }
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const content = await marketingAutomation.generateSocialContent({
            platform,
            tone,
            sourceText,
            accommodation,
            saveDraft: saveDraft || false
        });
        res.json({ success: true, content });
    } catch (error) {
        console.error('Error generating social content:', error);
        res.status(500).json({ success: false, error: 'Failed to generate social content' });
    }
});

// Admin endpoint - Get social content drafts
app.get('/api/admin/marketing/social-drafts', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const drafts = await marketingAutomation.getSocialDrafts(status || 'draft');
        res.json({ success: true, drafts });
    } catch (error) {
        console.error('Error getting social drafts:', error);
        res.status(500).json({ success: false, error: 'Failed to get social drafts' });
    }
});

// Admin endpoint - Update social draft status
app.put('/api/admin/marketing/social-drafts/:draftId', verifyAdmin, async (req, res) => {
    try {
        const { draftId } = req.params;
        const { status } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                success: false, 
                error: 'status is required' 
            });
        }
        
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.updateDraftStatus(draftId, status);
        res.json({ success: true, message: 'Draft status updated' });
    } catch (error) {
        console.error('Error updating draft status:', error);
        res.status(500).json({ success: false, error: 'Failed to update draft status' });
    }
});

// ==========================================
// ADMIN BOOKING CREATION (Manual booking entry)
// ==========================================

app.post('/api/admin/bookings', verifyAdmin, async (req, res) => {
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `;

        db.run(sql, [
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

// ==========================================
// SEASONAL RATES MANAGEMENT
// ==========================================

app.get('/api/admin/seasonal-rates', verifyAdmin, (req, res) => {
    const sql = 'SELECT * FROM seasonal_rates ORDER BY start_date ASC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching seasonal rates:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch seasonal rates' });
        }
        res.json({ success: true, rates: rows || [] });
    });
});

app.post('/api/admin/seasonal-rates', verifyAdmin, (req, res) => {
    const { name, start_date, end_date, multiplier, is_active } = req.body;
    
    if (!name || !start_date || !end_date) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: name, start_date, end_date'
        });
    }

    const sql = `
        INSERT INTO seasonal_rates (name, start_date, end_date, multiplier, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;
    
    db.run(sql, [
        sanitizeInput(name),
        start_date,
        end_date,
        multiplier || 1.0,
        is_active !== false ? 1 : 0
    ], function(err) {
        if (err) {
            console.error('Error creating seasonal rate:', err);
            return res.status(500).json({ success: false, error: 'Failed to create seasonal rate' });
        }
        res.json({
            success: true,
            rate: {
                id: this.lastID,
                name,
                start_date,
                end_date,
                multiplier: multiplier || 1.0,
                is_active: is_active !== false
            }
        });
    });
});

app.put('/api/admin/seasonal-rates/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { name, start_date, end_date, multiplier, is_active } = req.body;
    
    const sql = `
        UPDATE seasonal_rates 
        SET name = ?, start_date = ?, end_date = ?, multiplier = ?, is_active = ?, updated_at = datetime('now')
        WHERE id = ?
    `;
    
    db.run(sql, [
        sanitizeInput(name),
        start_date,
        end_date,
        multiplier || 1.0,
        is_active ? 1 : 0,
        id
    ], function(err) {
        if (err) {
            console.error('Error updating seasonal rate:', err);
            return res.status(500).json({ success: false, error: 'Failed to update seasonal rate' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Seasonal rate not found' });
        }
        res.json({ success: true, message: 'Seasonal rate updated' });
    });
});

app.delete('/api/admin/seasonal-rates/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM seasonal_rates WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Error deleting seasonal rate:', err);
            return res.status(500).json({ success: false, error: 'Failed to delete seasonal rate' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Seasonal rate not found' });
        }
        res.json({ success: true, message: 'Seasonal rate deleted' });
    });
});

// ==========================================
// GALLERY MANAGEMENT
// ==========================================

app.get('/api/admin/gallery', verifyAdmin, (req, res) => {
    const fs = require('fs');
    const imagesDir = path.join(__dirname, 'public', 'images');
    
    fs.readdir(imagesDir, (err, files) => {
        if (err) {
            console.error('Error reading images directory:', err);
            return res.status(500).json({ success: false, error: 'Failed to read images' });
        }
        
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
        );
        
        const sql = 'SELECT * FROM gallery_images ORDER BY display_order ASC';
        db.all(sql, [], (err, dbImages) => {
            if (err) {
                console.error('Error fetching gallery metadata:', err);
            }
            
            const dbImageMap = new Map((dbImages || []).map(img => [img.filename, img]));
            
            const images = imageFiles.map((filename, index) => {
                const dbData = dbImageMap.get(filename);
                return {
                    id: dbData?.id || null,
                    filename,
                    url: `/images/${filename}`,
                    title: dbData?.title || filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
                    description: dbData?.description || '',
                    property: dbData?.property || 'all',
                    is_hero: dbData?.is_hero || false,
                    is_featured: dbData?.is_featured || false,
                    display_order: dbData?.display_order || index
                };
            });
            
            res.json({
                success: true,
                images,
                total: images.length,
                storage_used: images.length * 0.5
            });
        });
    });
});

app.put('/api/admin/gallery/:filename', verifyAdmin, (req, res) => {
    const { filename } = req.params;
    const { title, description, property, is_hero, is_featured, display_order } = req.body;
    
    const checkSql = 'SELECT id FROM gallery_images WHERE filename = ?';
    db.get(checkSql, [filename], (err, existing) => {
        if (err) {
            console.error('Error checking gallery image:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (existing) {
            const updateSql = `
                UPDATE gallery_images 
                SET title = ?, description = ?, property = ?, is_hero = ?, is_featured = ?, display_order = ?, updated_at = datetime('now')
                WHERE filename = ?
            `;
            db.run(updateSql, [
                sanitizeInput(title || ''),
                sanitizeInput(description || ''),
                property || 'all',
                is_hero ? 1 : 0,
                is_featured ? 1 : 0,
                display_order || 0,
                filename
            ], function(err) {
                if (err) {
                    console.error('Error updating gallery image:', err);
                    return res.status(500).json({ success: false, error: 'Failed to update image' });
                }
                res.json({ success: true, message: 'Image updated' });
            });
        } else {
            const insertSql = `
                INSERT INTO gallery_images (filename, title, description, property, is_hero, is_featured, display_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `;
            db.run(insertSql, [
                filename,
                sanitizeInput(title || ''),
                sanitizeInput(description || ''),
                property || 'all',
                is_hero ? 1 : 0,
                is_featured ? 1 : 0,
                display_order || 0
            ], function(err) {
                if (err) {
                    console.error('Error inserting gallery image:', err);
                    return res.status(500).json({ success: false, error: 'Failed to save image metadata' });
                }
                res.json({ success: true, message: 'Image metadata saved', id: this.lastID });
            });
        }
    });
});

// ==========================================
// REVIEWS MANAGEMENT
// ==========================================

app.get('/api/admin/reviews', verifyAdmin, (req, res) => {
    const { status, platform, property } = req.query;
    let sql = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];
    
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    if (platform) {
        sql += ' AND platform = ?';
        params.push(platform);
    }
    if (property) {
        sql += ' AND property = ?';
        params.push(property);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching reviews:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
        }
        
        const reviews = rows || [];
        const stats = {
            total: reviews.length,
            pending: reviews.filter(r => r.status === 'pending').length,
            approved: reviews.filter(r => r.status === 'approved').length,
            featured: reviews.filter(r => r.is_featured).length,
            average_rating: reviews.length > 0 
                ? (reviews.reduce((sum, r) => sum + (r.rating || 5), 0) / reviews.length).toFixed(1)
                : 0
        };
        
        res.json({ success: true, reviews, stats });
    });
});

app.post('/api/admin/reviews', verifyAdmin, (req, res) => {
    const { guest_name, platform, rating, review_text, stay_date, property } = req.body;
    
    if (!guest_name) {
        return res.status(400).json({ success: false, error: 'Guest name is required' });
    }
    
    const sql = `
        INSERT INTO reviews (guest_name, platform, rating, review_text, stay_date, property, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `;
    
    db.run(sql, [
        sanitizeInput(guest_name),
        platform || 'direct',
        rating || 5,
        sanitizeInput(review_text || ''),
        stay_date || null,
        property || null
    ], function(err) {
        if (err) {
            console.error('Error creating review:', err);
            return res.status(500).json({ success: false, error: 'Failed to create review' });
        }
        res.json({ success: true, id: this.lastID, message: 'Review created' });
    });
});

app.put('/api/admin/reviews/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { status, is_featured, admin_notes, admin_response } = req.body;
    
    let sql = 'UPDATE reviews SET updated_at = datetime(\'now\')';
    const params = [];
    
    if (status !== undefined) {
        sql += ', status = ?';
        params.push(status);
    }
    if (is_featured !== undefined) {
        sql += ', is_featured = ?';
        params.push(is_featured ? 1 : 0);
    }
    if (admin_notes !== undefined) {
        sql += ', admin_notes = ?';
        params.push(sanitizeInput(admin_notes));
    }
    if (admin_response !== undefined) {
        sql += ', admin_response = ?, response_date = datetime(\'now\')';
        params.push(sanitizeInput(admin_response));
    }
    
    sql += ' WHERE id = ?';
    params.push(id);
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error updating review:', err);
            return res.status(500).json({ success: false, error: 'Failed to update review' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Review not found' });
        }
        res.json({ success: true, message: 'Review updated' });
    });
});

app.delete('/api/admin/reviews/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM reviews WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Error deleting review:', err);
            return res.status(500).json({ success: false, error: 'Failed to delete review' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Review not found' });
        }
        res.json({ success: true, message: 'Review deleted' });
    });
});

// ==========================================
// PRICING MANAGEMENT
// ==========================================

// Public endpoint to get pricing for website display (no auth required)
app.get('/api/pricing', (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    const sql = "SELECT * FROM system_settings WHERE setting_key LIKE 'pricing_%'";
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching public pricing:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
        }
        
        const defaultPricing = {
            'dome_pinot': { base: 450, weekend: 450, peak: 550, cleaning: 50, minNights: 2 },
            'dome_rose': { base: 380, weekend: 380, peak: 480, cleaning: 50, minNights: 2 },
            'lakeside_cottage': { base: 580, weekend: 580, peak: 680, cleaning: 50, minNights: 2 }
        };
        
        const pricing = { ...defaultPricing };
        (rows || []).forEach(row => {
            try {
                const key = row.setting_key.replace('pricing_', '');
                pricing[key] = JSON.parse(row.setting_value);
            } catch (e) {
                console.error('Error parsing pricing:', e);
            }
        });
        
        res.json({ success: true, pricing });
    });
});

// Get all pricing data (admin)
app.get('/api/admin/pricing', verifyAdmin, (req, res) => {
    const sql = "SELECT * FROM system_settings WHERE setting_key LIKE 'pricing_%'";
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching pricing:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
        }
        
        const pricing = {};
        (rows || []).forEach(row => {
            try {
                pricing[row.setting_key] = JSON.parse(row.setting_value);
            } catch (e) {
                pricing[row.setting_key] = row.setting_value;
            }
        });
        
        res.json({ success: true, pricing });
    });
});

// Helper function to ensure system_settings table exists with proper schema
function ensureSystemSettingsTable(callback) {
    const createTableSql = `
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

// Save pricing for an accommodation
app.post('/api/admin/pricing', verifyAdmin, (req, res) => {
    const { accommodation, base, weekend, peak, cleaning, minNights } = req.body;
    
    if (!accommodation) {
        return res.status(400).json({ success: false, error: 'Accommodation name required' });
    }
    
    const settingKey = `pricing_${accommodation.toLowerCase().replace(/\s+/g, '_')}`;
    const pricingData = JSON.stringify({
        base: parseFloat(base) || 0,
        weekend: parseFloat(weekend) || 0,
        peak: parseFloat(peak) || 0,
        cleaning: parseFloat(cleaning) || 0,
        minNights: parseInt(minNights) || 2
    });
    
    // Ensure the table exists before attempting to save
    ensureSystemSettingsTable((tableErr) => {
        if (tableErr) {
            console.error('Failed to ensure system_settings table:', tableErr);
            return res.status(500).json({ success: false, error: 'Database initialization failed: ' + tableErr.message });
        }
        
        const sql = `
            INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
            VALUES (?, ?, 'json', datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = datetime('now')
        `;
        
        db.run(sql, [settingKey, pricingData], function(err) {
            if (err) {
                console.error('Error saving pricing:', err);
                return res.status(500).json({ success: false, error: 'Failed to save pricing: ' + err.message });
            }
            res.json({ success: true, message: 'Pricing saved successfully' });
        });
    });
});

// ==========================================
// SYSTEM SETTINGS
// ==========================================

app.get('/api/admin/settings', verifyAdmin, (req, res) => {
    const sql = 'SELECT * FROM system_settings';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching settings:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch settings' });
        }
        
        const settings = {};
        (rows || []).forEach(row => {
            let value = row.setting_value;
            if (row.setting_type === 'boolean') {
                value = value === 'true' || value === '1';
            } else if (row.setting_type === 'number') {
                value = parseFloat(value);
            } else if (row.setting_type === 'json') {
                try { value = JSON.parse(value); } catch (e) { }
            }
            settings[row.setting_key] = value;
        });
        
        res.json({ success: true, settings });
    });
});

app.put('/api/admin/settings', verifyAdmin, (req, res) => {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'Settings object required' });
    }
    
    const entries = Object.entries(settings);
    let completed = 0;
    let errors = [];
    
    entries.forEach(([key, value]) => {
        let settingType = 'string';
        let settingValue = String(value);
        
        if (typeof value === 'boolean') {
            settingType = 'boolean';
            settingValue = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
            settingType = 'number';
            settingValue = String(value);
        } else if (typeof value === 'object') {
            settingType = 'json';
            settingValue = JSON.stringify(value);
        }
        
        const sql = `
            INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            setting_type = excluded.setting_type,
            updated_at = datetime('now')
        `;
        
        db.run(sql, [key, settingValue, settingType], function(err) {
            if (err) {
                errors.push({ key, error: err.message });
            }
            completed++;
            
            if (completed === entries.length) {
                if (errors.length > 0) {
                    res.status(500).json({ success: false, errors });
                } else {
                    res.json({ success: true, message: 'Settings saved' });
                }
            }
        });
    });
    
    if (entries.length === 0) {
        res.json({ success: true, message: 'No settings to save' });
    }
});

// ==========================================
// BACKUP SYSTEM
// ==========================================

app.get('/api/admin/backups', verifyAdmin, (req, res) => {
    const fs = require('fs');
    const backupDir = './backups';
    
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.readdir(backupDir, (err, files) => {
        if (err) {
            console.error('Error reading backups directory:', err);
            return res.status(500).json({ success: false, error: 'Failed to read backups' });
        }
        
        const backups = files
            .filter(file => file.endsWith('.db') || file.endsWith('.json'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: Math.round(stats.size / 1024),
                    created_at: stats.mtime.toISOString(),
                    type: file.includes('system-backup') ? 'system' : 'database'
                };
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
        
        res.json({
            success: true,
            backups,
            stats: {
                total: backups.length,
                storage_used_kb: totalSize,
                storage_used_mb: (totalSize / 1024).toFixed(2)
            }
        });
    });
});

app.post('/api/admin/backups', verifyAdmin, async (req, res) => {
    try {
        const BackupSystem = require('./backup-system');
        const backupSystem = new BackupSystem();
        
        const result = await backupSystem.performBackup();
        
        res.json({
            success: true,
            message: 'Backup created successfully',
            database: result.database,
            system: result.system
        });
    } catch (error) {
        console.error('Error creating backup:', error);
        res.status(500).json({ success: false, error: 'Failed to create backup' });
    }
});

app.get('/api/admin/backups/:filename', verifyAdmin, (req, res) => {
    const { filename } = req.params;
    const fs = require('fs');
    const backupPath = path.join('./backups', filename);
    
    if (!filename.match(/^[a-zA-Z0-9_.-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: 'Backup not found' });
    }
    
    res.download(backupPath, filename);
});

app.delete('/api/admin/backups/:filename', verifyAdmin, (req, res) => {
    const { filename } = req.params;
    const fs = require('fs');
    const backupPath = path.join('./backups', filename);
    
    if (!filename.match(/^[a-zA-Z0-9_.-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: 'Backup not found' });
    }
    
    fs.unlink(backupPath, (err) => {
        if (err) {
            console.error('Error deleting backup:', err);
            return res.status(500).json({ success: false, error: 'Failed to delete backup' });
        }
        res.json({ success: true, message: 'Backup deleted' });
    });
});

// ==========================================
// SEO-FRIENDLY ROUTES (MUST BE LAST)
// ==========================================

// SEO-friendly page routes - serve index.html with page context
// These routes allow Google to crawl individual pages
const seoPages = {
    '/': { page: 'home', title: 'Central Otago Luxury Glamping Dome Accommodation', description: 'Book luxury Central Otago accommodation on Lake Dunstan. Energy-positive geodesic domes & lakeside cottage, 55min from Queenstown.' },
    '/stay': { page: 'stay', title: 'Accommodation - Luxury Glamping Domes & Cottage', description: 'Choose from Dome Pinot ($580/night), Dome Rose ($550/night), or Lakeside Cottage ($300/night). Solar-powered luxury accommodation in Central Otago.' },
    '/gallery': { page: 'gallery', title: 'Photo Gallery - Lake Dunstan Views & Interiors', description: 'Browse photos of our luxury glamping domes, lakeside cottage, and stunning Central Otago scenery. Lake Dunstan views, private spas, and wine country.' },
    '/guides': { page: 'blog', title: 'Local Guides - Wine Tours, Cycling & Activities', description: 'Discover Central Otago wine trails, Otago Rail Trail cycling routes, and local attractions near Lakeside Retreat.' },
    '/blog': { page: 'blog', title: 'Local Guides - Wine Tours, Cycling & Activities', description: 'Discover Central Otago wine trails, Otago Rail Trail cycling routes, and local attractions near Lakeside Retreat.' },
    '/reviews': { page: 'reviews', title: 'Guest Reviews - 4.9 Star Rating', description: 'Read 127+ guest reviews of Lakeside Retreat. Rated 4.9/5 stars for luxury glamping accommodation in Central Otago.' },
    '/story': { page: 'story', title: 'Our Story - Meet Stephen & Sandy', description: 'Learn about Stephen & Sandy, the hosts of Lakeside Retreat, and their journey creating sustainable luxury accommodation in Central Otago.' },
    '/explore': { page: 'explore', title: 'Explore Central Otago - Wineries, Cycling & Activities', description: 'Discover nearby wineries, Otago Rail Trail access, Lake Dunstan activities, and local attractions from Lakeside Retreat.' },
    '/contact': { page: 'contact', title: 'Contact Us - Bookings & Enquiries', description: 'Contact Lakeside Retreat for bookings and enquiries. Phone: +64-21-368-682, Email: info@lakesideretreat.co.nz' }
};

// Handle SEO-friendly URLs
Object.keys(seoPages).forEach(route => {
    if (route !== '/') {
        app.get(route, (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }
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
    console.log(`💾 Backup system:`, process.env.NODE_ENV === 'production' ? 'SCHEDULED' : 'MANUAL');
});
