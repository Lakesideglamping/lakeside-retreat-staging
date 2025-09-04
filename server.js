const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Admin login endpoint
app.post('/api/admin/login', async (req, res) => {
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

// SPA routing - serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${__dirname}`);
});