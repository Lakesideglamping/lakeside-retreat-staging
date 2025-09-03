const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy for deployment
app.set('trust proxy', 1);

// Security with proper CSP that allows your inline JavaScript
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'",  // Allow inline scripts like your navigation
                "'unsafe-eval'",    // Allow eval() if needed
                "https://www.googletagmanager.com",
                "https://cdnjs.cloudflare.com", 
                "https://www.clarity.ms",
                "https://js.stripe.com"
            ],
            styleSrc: [
                "'self'", 
                "'unsafe-inline'",  // Allow inline styles
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com"
            ],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https:", "wss:"],
            mediaSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            workerSrc: ["'self'"],
            childSrc: ["'self'"]
        }
    }
}));

// CORS with proper origins
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://lakeside-retreat-website.onrender.com', 'https://lakesideretreat.co.nz']
        : true,
    credentials: true
}));

// Compression
app.use(compression());

// Rate limiting with health check exclusion
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    skip: (req) => req.path === '/api/health' || req.path.match(/\.(css|js|jpg|jpeg|png|gif|ico|woff|woff2|ttf|svg)$/i)
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static files
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.static(__dirname));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});