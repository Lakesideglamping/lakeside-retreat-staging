#!/usr/bin/env node

/**
 * Secure Admin Setup Script for Lakeside Retreat
 * Generates secure credentials and environment configuration
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function generateSecureSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

async function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function askPassword(question) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        
        stdout.write(question);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        
        let password = '';
        
        stdin.on('data', function(ch) {
            ch = ch + '';
            
            switch(ch) {
                case '\n':
                case '\r':
                case '\u0004': // Ctrl+D
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdout.write('\n');
                    resolve(password);
                    break;
                case '\u0003': // Ctrl+C
                    process.exit();
                    break;
                default:
                    password += ch;
                    stdout.write('*');
                    break;
            }
        });
    });
}

async function setupAdmin() {
    try {
        console.log('🔐 Secure Admin Setup for Lakeside Retreat\n');
        console.log('This script will create a secure admin configuration.\n');

        // Get admin credentials
        const username = await askQuestion('Enter admin username (default: admin): ') || 'admin';
        
        let password;
        while (!password || password.length < 12) {
            password = await askPassword('Enter secure admin password (min 12 chars): ');
            if (!password || password.length < 12) {
                console.log('❌ Password must be at least 12 characters long!');
            }
        }

        const confirmPassword = await askPassword('Confirm password: ');
        if (password !== confirmPassword) {
            console.log('❌ Passwords do not match!');
            process.exit(1);
        }

        console.log('\n🔧 Generating secure configuration...');

        // Generate secure secrets
        const jwtSecret = generateSecureSecret(64);
        const sessionSecret = generateSecureSecret(32);
        
        // Hash password with bcrypt
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create .env file
        const envContent = `# Lakeside Retreat Environment Variables - GENERATED ${new Date().toISOString()}
# KEEP THIS FILE SECURE - DO NOT COMMIT TO VERSION CONTROL!

# Server Configuration
PORT=10000
NODE_ENV=development

# Admin Credentials - CHANGE THESE IN PRODUCTION!
ADMIN_USERNAME=${username}
ADMIN_PASSWORD_HASH=${passwordHash}

# JWT Configuration - SECURE RANDOM GENERATED
JWT_SECRET=${jwtSecret}
JWT_EXPIRY=1h

# Session Configuration
SESSION_SECRET=${sessionSecret}
SESSION_TIMEOUT_MINUTES=60

# Database Configuration
DATABASE_URL=sqlite:./lakeside.db

# Rate Limiting Configuration
LOGIN_RATE_LIMIT_ATTEMPTS=5
LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
GENERAL_RATE_LIMIT_REQUESTS=100
GENERAL_RATE_LIMIT_WINDOW_MINUTES=15

# Security Settings
BCRYPT_ROUNDS=12
SECURE_COOKIES=true
HTTPS_ONLY=false

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=./logs/app.log

# Email Configuration (Update with your SMTP settings)
EMAIL_HOST=smtp.titan.email
EMAIL_PORT=587
EMAIL_USER=info@lakesideretreat.co.nz
EMAIL_PASS=your_titan_email_password
FROM_EMAIL=info@lakesideretreat.co.nz

# Stripe Configuration (Optional - Update with your keys)
STRIPE_SECRET_KEY=sk_test_your_stripe_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
`;

        // Write .env file
        fs.writeFileSync('.env', envContent);

        // Create logs directory
        if (!fs.existsSync('./logs')) {
            fs.mkdirSync('./logs');
        }

        console.log('\n✅ Secure configuration created successfully!');
        console.log('\n📁 Files created:');
        console.log('   ✓ .env (secure environment variables)');
        console.log('   ✓ ./logs/ (logging directory)');
        
        console.log('\n🔐 Admin Credentials:');
        console.log(`   Username: ${username}`);
        console.log(`   Password: [HIDDEN - as configured]`);
        
        console.log('\n🌐 Access URLs:');
        console.log('   Admin Login: http://localhost:10000/admin');
        console.log('   Dashboard:   http://localhost:10000/admin-dashboard.html');
        
        console.log('\n⚠️  SECURITY NOTES:');
        console.log('   • Never commit the .env file to version control');
        console.log('   • Keep your admin password secure');
        console.log('   • Change default passwords in production');
        console.log('   • Update email and payment configurations as needed');
        
        console.log('\n🚀 Ready to start! Run: node server-render.js');

        rl.close();
        
    } catch (error) {
        console.error('❌ Setup error:', error);
        rl.close();
        process.exit(1);
    }
}

// Run the setup
setupAdmin().catch(err => {
    console.error('❌ Fatal error:', err);
    rl.close();
    process.exit(1);
});