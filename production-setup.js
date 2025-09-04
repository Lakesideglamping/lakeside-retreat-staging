#!/usr/bin/env node

/**
 * Production Setup Script for Lakeside Retreat
 * Generates secure production configuration with all security features
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('🏔️  LAKESIDE RETREAT - PRODUCTION SETUP');
console.log('=====================================\n');

function generateSecureSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex');
}

function generateStrongPassword(length = 16) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    // Ensure at least one of each type
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
    password += '0123456789'[Math.floor(Math.random() * 10)];
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
    
    // Fill remaining length
    for (let i = 4; i < length; i++) {
        password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

async function createProductionConfig() {
    try {
        console.log('🔧 Generating secure production configuration...\n');

        // Generate secure credentials
        const adminUsername = 'lakeside_admin_' + Math.random().toString(36).substring(2, 8);
        const adminPassword = generateStrongPassword(20);
        const jwtSecret = generateSecureSecret(64);
        const sessionSecret = generateSecureSecret(32);
        
        console.log('🔐 Generated secure credentials:');
        console.log(`   Username: ${adminUsername}`);
        console.log(`   Password: ${adminPassword}`);
        console.log('   JWT Secret: [64-character secure random]');
        console.log('   Session Secret: [32-character secure random]\n');

        // Hash password with bcrypt
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

        // Production environment configuration
        const productionEnv = `# LAKESIDE RETREAT - PRODUCTION ENVIRONMENT
# Generated: ${new Date().toISOString()}
# SECURITY: KEEP THIS FILE SECURE - DO NOT COMMIT TO VERSION CONTROL!

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================
PORT=10000
NODE_ENV=production

# =============================================================================
# ADMIN CREDENTIALS - PRODUCTION SECURE
# =============================================================================
ADMIN_USERNAME=${adminUsername}
ADMIN_PASSWORD_HASH=${passwordHash}

# =============================================================================
# JWT & SESSION SECURITY
# =============================================================================
JWT_SECRET=${jwtSecret}
JWT_EXPIRY=1h
SESSION_SECRET=${sessionSecret}
SESSION_TIMEOUT_MINUTES=30

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================
DATABASE_URL=sqlite:./production/lakeside.db

# =============================================================================
# RATE LIMITING - PRODUCTION STRICT
# =============================================================================
LOGIN_RATE_LIMIT_ATTEMPTS=3
LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
GENERAL_RATE_LIMIT_REQUESTS=50
GENERAL_RATE_LIMIT_WINDOW_MINUTES=15

# =============================================================================
# SECURITY SETTINGS - PRODUCTION HARDENED
# =============================================================================
BCRYPT_ROUNDS=12
SECURE_COOKIES=true
HTTPS_ONLY=true
TRUST_PROXY=true

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================
LOG_LEVEL=warn
LOG_FILE=./logs/app.log
ERROR_LOG_FILE=./logs/error.log
SECURITY_LOG_FILE=./logs/security.log

# =============================================================================
# MONITORING & HEALTH
# =============================================================================
HEALTH_CHECK_ENABLED=true
MONITORING_SECRET=${generateSecureSecret(32)}

# =============================================================================
# EMAIL CONFIGURATION - UPDATE WITH YOUR SETTINGS
# =============================================================================
EMAIL_HOST=smtp.titan.email
EMAIL_PORT=587
EMAIL_USER=info@lakesideretreat.co.nz
EMAIL_PASS=your_secure_email_password_here
FROM_EMAIL=info@lakesideretreat.co.nz

# =============================================================================
# STRIPE CONFIGURATION - UPDATE WITH YOUR KEYS
# =============================================================================
STRIPE_SECRET_KEY=sk_live_your_live_stripe_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# =============================================================================
# BACKUP CONFIGURATION
# =============================================================================
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_LOCATION=./backups/

# =============================================================================
# SSL/TLS CONFIGURATION
# =============================================================================
SSL_KEY_PATH=./ssl/private.key
SSL_CERT_PATH=./ssl/certificate.crt
SSL_CA_PATH=./ssl/ca_bundle.crt
`;

        // Create production directory structure
        const directories = [
            './production',
            './logs',
            './backups',
            './ssl',
            './config'
        ];

        directories.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });

        // Write production environment file
        fs.writeFileSync('.env.production', productionEnv);
        
        // Create secure credentials file (for admin reference)
        const credentialsFile = `# LAKESIDE RETREAT - ADMIN CREDENTIALS
# Generated: ${new Date().toISOString()}
# SECURITY: STORE THIS SECURELY AND DELETE AFTER SETUP!

Admin Login Credentials:
========================
Username: ${adminUsername}
Password: ${adminPassword}

Access URLs:
============
Admin Panel: https://your-domain.com/admin
Health Check: https://your-domain.com/api/health

IMPORTANT SECURITY NOTES:
========================
1. Store these credentials in a secure password manager
2. Delete this file after copying the credentials
3. Change the email and Stripe configuration in .env.production
4. Set up SSL certificates in the ./ssl/ directory
5. Configure your reverse proxy/load balancer

Next Steps:
===========
1. Copy .env.production to .env
2. Update email and payment settings
3. Install SSL certificates
4. Start the production server: npm run start:production
`;

        fs.writeFileSync('ADMIN-CREDENTIALS.txt', credentialsFile);

        console.log('✅ Production configuration created successfully!\n');
        console.log('📁 Files created:');
        console.log('   ✓ .env.production (production environment)');
        console.log('   ✓ ADMIN-CREDENTIALS.txt (admin login info)');
        console.log('   ✓ ./production/ (database directory)');
        console.log('   ✓ ./logs/ (logging directory)');
        console.log('   ✓ ./backups/ (backup directory)');
        console.log('   ✓ ./ssl/ (SSL certificate directory)');
        
        console.log('\n🔒 PRODUCTION SECURITY FEATURES:');
        console.log('   • Bcrypt password hashing (12 rounds)');
        console.log('   • 64-character JWT secrets');
        console.log('   • Stricter rate limiting (3 attempts/15min)');
        console.log('   • HTTPS enforcement');
        console.log('   • Secure cookie settings');
        console.log('   • Comprehensive logging');
        console.log('   • Automated backup support');
        
        console.log('\n⚠️  NEXT STEPS:');
        console.log('   1. Review ADMIN-CREDENTIALS.txt and store securely');
        console.log('   2. Update email settings in .env.production');
        console.log('   3. Add your Stripe keys to .env.production');
        console.log('   4. Install SSL certificates in ./ssl/');
        console.log('   5. Copy .env.production to .env for deployment');
        console.log('   6. Delete ADMIN-CREDENTIALS.txt after setup');
        
        console.log('\n🚀 Ready for production deployment!');
        
    } catch (error) {
        console.error('❌ Setup error:', error);
        process.exit(1);
    }
}

// Check for required dependencies
const requiredDeps = ['bcryptjs', 'crypto'];
const missingDeps = [];

requiredDeps.forEach(dep => {
    try {
        require.resolve(dep);
    } catch (e) {
        if (dep !== 'crypto') missingDeps.push(dep); // crypto is built-in
    }
});

if (missingDeps.length > 0) {
    console.error('❌ Missing dependencies:', missingDeps.join(', '));
    console.error('Please run: npm install');
    process.exit(1);
}

// Run the setup
createProductionConfig().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});