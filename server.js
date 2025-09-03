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

// Basic security - NO CSP that breaks JavaScript
app.use(helmet({
    contentSecurityPolicy: false  // Disable CSP entirely
}));

// CORS - allow all in production for now
app.use(cors());

// Compression
app.use(compression());

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