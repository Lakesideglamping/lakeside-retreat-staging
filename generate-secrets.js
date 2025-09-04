#!/usr/bin/env node

/**
 * 🔐 PRODUCTION SECRET GENERATOR
 * Generates cryptographically secure secrets for production deployment
 * 
 * Usage: node generate-secrets.js
 */

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\n' + '='.repeat(70));
console.log('🔐 LAKESIDE RETREAT - PRODUCTION SECRET GENERATOR');
console.log('='.repeat(70) + '\n');

// Function to generate secure random secrets
function generateSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

// Function to generate strong password
function generateStrongPassword(length = 16) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
        password += charset[randomBytes[i] % charset.length];
    }
    
    // Ensure password has at least one of each type
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);
    
    if (!hasLower || !hasUpper || !hasNumber || !hasSpecial) {
        return generateStrongPassword(length); // Regenerate if requirements not met
    }
    
    return password;
}

// Generate bcrypt hash (requires bcryptjs package)
async function generateBcryptHash(password) {
    try {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(12);
        const hash = await bcrypt.hash(password, salt);
        return hash;
    } catch (error) {
        console.log('⚠️  bcryptjs not installed. To generate password hash, run:');
        console.log('    npm install bcryptjs');
        console.log('    Then run this script again\n');
        return null;
    }
}

// Main generation function
async function generateAllSecrets() {
    console.log('📋 GENERATING PRODUCTION SECRETS...\n');
    
    // 1. JWT Secret (64 characters)
    const jwtSecret = generateSecret(32);
    console.log('1️⃣  JWT_SECRET (64 characters):');
    console.log(`   ${jwtSecret}`);
    console.log('   ✅ Use for: JWT token signing\n');
    
    // 2. Session Secret (64 characters)
    const sessionSecret = generateSecret(32);
    console.log('2️⃣  SESSION_SECRET (64 characters):');
    console.log(`   ${sessionSecret}`);
    console.log('   ✅ Use for: Express session encryption\n');
    
    // 3. Admin Username
    console.log('3️⃣  ADMIN_USERNAME:');
    const suggestedUsername = 'admin_' + generateSecret(4);
    console.log(`   Suggested: ${suggestedUsername}`);
    console.log('   ✅ Or use your own unique username\n');
    
    // 4. Admin Password
    const adminPassword = generateStrongPassword(16);
    console.log('4️⃣  ADMIN_PASSWORD (strong, 16 characters):');
    console.log(`   ${adminPassword}`);
    console.log('   ⚠️  SAVE THIS SECURELY - You will need it to log in!\n');
    
    // 5. Admin Password Hash
    console.log('5️⃣  ADMIN_PASSWORD_HASH (bcrypt hash):');
    const hash = await generateBcryptHash(adminPassword);
    if (hash) {
        console.log(`   ${hash}`);
        console.log('   ✅ Use this hash in your environment variables\n');
    }
    
    // 6. Uplisting Webhook Secret
    const uplistingWebhookSecret = generateSecret(32);
    console.log('6️⃣  UPLISTING_WEBHOOK_SECRET (64 characters):');
    console.log(`   ${uplistingWebhookSecret}`);
    console.log('   ✅ Configure this in Uplisting webhook settings\n');
    
    // 7. Database Encryption Key (if needed)
    const dbEncryptionKey = generateSecret(32);
    console.log('7️⃣  DATABASE_ENCRYPTION_KEY (64 characters):');
    console.log(`   ${dbEncryptionKey}`);
    console.log('   ✅ Optional: For encrypting sensitive database fields\n');
    
    // 8. CSRF Token Secret
    const csrfSecret = generateSecret(32);
    console.log('8️⃣  CSRF_SECRET (64 characters):');
    console.log(`   ${csrfSecret}`);
    console.log('   ✅ Use for: CSRF protection tokens\n');
    
    console.log('='.repeat(70));
    console.log('📝 ENVIRONMENT VARIABLES FOR RENDER.COM:\n');
    console.log('Copy and paste these into your Render.com environment settings:\n');
    
    console.log(`NODE_ENV=production`);
    console.log(`PORT=10000`);
    console.log(`TRUST_PROXY=true`);
    console.log(`JWT_SECRET=${jwtSecret}`);
    console.log(`SESSION_SECRET=${sessionSecret}`);
    console.log(`ADMIN_USERNAME=${suggestedUsername}`);
    if (hash) {
        console.log(`ADMIN_PASSWORD_HASH=${hash}`);
    }
    console.log(`UPLISTING_WEBHOOK_SECRET=${uplistingWebhookSecret}`);
    console.log(`DATABASE_ENCRYPTION_KEY=${dbEncryptionKey}`);
    console.log(`CSRF_SECRET=${csrfSecret}`);
    
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  SECURITY REMINDERS:');
    console.log('='.repeat(70));
    console.log('1. NEVER commit these secrets to Git');
    console.log('2. NEVER share these secrets via email or chat');
    console.log('3. Store the admin password in a password manager');
    console.log('4. Use different secrets for development and production');
    console.log('5. Rotate secrets every 90 days');
    console.log('6. Enable 2FA on your Render.com account');
    
    console.log('\n✅ Secrets generated successfully!\n');
}

// Ask if user wants to generate secrets
rl.question('Generate new production secrets? (yes/no): ', (answer) => {
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        generateAllSecrets().then(() => {
            rl.close();
        });
    } else {
        console.log('❌ Secret generation cancelled.\n');
        rl.close();
    }
});