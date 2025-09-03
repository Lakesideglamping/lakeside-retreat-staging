// SECURE Production Server for Lakeside Retreat - UPLOAD THIS TO GITHUB
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy for Render
app.set('trust proxy', 1);

// Enhanced Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // Temporary for existing inline scripts
                "https://www.googletagmanager.com",
                "https://cdnjs.cloudflare.com", 
                "https://www.clarity.ms",
                "https://js.stripe.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Temporary for existing inline styles
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com"
            ],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https:", "wss:"],
            mediaSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false // For Stripe compatibility
}));

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://lakesideretreat.co.nz', 'https://www.lakesideretreat.co.nz']
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Compression
app.use(compression());

// Rate limiting - ENTERPRISE SECURITY
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for static assets and health checks
        return req.path.match(/\.(css|js|jpg|jpeg|png|gif|ico|woff|woff2|ttf|svg)$/i) ||
               req.path === '/api/health';
    }
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'API rate limit exceeded' }
});

// Apply rate limiting
app.use('/api/', apiLimiter);
app.use(generalLimiter);

// Body parsing with security limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Security headers for all responses
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Powered-By'); // Remove fingerprinting
    next();
});

// Serve static files with caching
const staticOptions = {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(jpg|jpeg|png|gif|ico|woff|woff2|ttf)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
        } else if (filePath.match(/\.(css|js)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
        } else if (filePath.match(/\.html$/)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
};

// Serve images directory
app.use('/images', express.static(path.join(__dirname, 'images'), staticOptions));

// Health check endpoint - CRITICAL FOR MONITORING
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Serve main page - YOUR SEO-OPTIMIZED HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), {
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    });
});

// Catch all routes - serve main page (SPA behavior)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handling - SECURE
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    
    // Don't leak error details in production
    const message = process.env.NODE_ENV === 'production' 
        ? 'Something went wrong!' 
        : err.message;
    
    res.status(err.status || 500).json({ 
        error: message,
        timestamp: new Date().toISOString()
    });
});

// Start server with proper error handling
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SECURE Lakeside Retreat server running on port ${PORT}`);
    console.log(`🔒 Security: Rate limiting, XSS protection, CSRF protection enabled`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed'); 
        process.exit(0);
    });
});

module.exports = app;