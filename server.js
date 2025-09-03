const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Disable CSP completely for now to ensure JavaScript works
app.use((req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Security-Policy');
    next();
});

// Simple static file serving
app.use(express.static(__dirname));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// SPA routing - serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
});