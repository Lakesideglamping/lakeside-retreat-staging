#!/usr/bin/env node

/**
 * 🔐 BCRYPT HASH GENERATOR
 * Generates bcrypt hash for admin password
 * 
 * Usage: node generate-bcrypt-hash.js
 */

const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\n' + '='.repeat(60));
console.log('🔐 BCRYPT PASSWORD HASH GENERATOR');
console.log('='.repeat(60) + '\n');

// Check if bcryptjs is installed
try {
    const bcrypt = require('bcryptjs');
    
    rl.question('Enter the password to hash: ', async (password) => {
        if (!password || password.length < 8) {
            console.log('\n❌ Password must be at least 8 characters long!\n');
            rl.close();
            return;
        }
        
        console.log('\nGenerating bcrypt hash (12 rounds)...\n');
        
        try {
            // Generate salt with 12 rounds (secure for production)
            const salt = await bcrypt.genSalt(12);
            const hash = await bcrypt.hash(password, salt);
            
            console.log('✅ BCRYPT HASH GENERATED:\n');
            console.log(`${hash}\n`);
            
            console.log('='.repeat(60));
            console.log('📋 ENVIRONMENT VARIABLE:\n');
            console.log(`ADMIN_PASSWORD_HASH=${hash}`);
            console.log('='.repeat(60) + '\n');
            
            // Verify the hash works
            const isValid = await bcrypt.compare(password, hash);
            if (isValid) {
                console.log('✅ Hash verified successfully!');
                console.log('   You can now use this hash in your environment variables.\n');
            } else {
                console.log('❌ Hash verification failed. Please try again.\n');
            }
            
            console.log('⚠️  SECURITY REMINDERS:');
            console.log('   • Store the original password in a password manager');
            console.log('   • Never commit the hash to Git');
            console.log('   • Use this hash in ADMIN_PASSWORD_HASH environment variable');
            console.log('   • The original password is what you\'ll use to log in\n');
            
        } catch (error) {
            console.error('❌ Error generating hash:', error.message);
        }
        
        rl.close();
    });
    
} catch (error) {
    console.log('❌ bcryptjs is not installed!\n');
    console.log('To install bcryptjs, run:');
    console.log('   npm install bcryptjs\n');
    console.log('Then run this script again:');
    console.log('   node generate-bcrypt-hash.js\n');
    rl.close();
}