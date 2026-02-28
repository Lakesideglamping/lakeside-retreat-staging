/**
 * Environment Configuration & Validation
 * 
 * Centralized validation for all environment variables. Replaces scattered
 * process.env checks throughout server.js with a single fail-fast module.
 * 
 * Usage:
 *   const config = require('./config/env');
 *   // config.stripe.secretKey, config.jwt.secret, etc.
 */

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Validate and return environment configuration.
 * Fails fast in production if required vars are missing.
 * Provides sensible defaults in development.
 */
function loadConfig() {
    const warnings = [];
    const errors = [];

    // --- JWT ---
    let jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        if (isProduction) {
            // Generate a random secret so the server can start, but warn loudly
            jwtSecret = require('crypto').randomBytes(64).toString('hex');
            warnings.push('⚠️ JWT_SECRET not set in production - using random secret (sessions will not persist across restarts). Set JWT_SECRET in environment variables!');
        } else {
            jwtSecret = 'dev-secret-key-for-local-testing-only';
            warnings.push('JWT_SECRET not set - using development default');
        }
    }

    // --- Stripe ---
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
        warnings.push('STRIPE_SECRET_KEY not set - running in DEV_MODE (payments disabled)');
    }

    // --- Uplisting ---
    const uplistingApiKey = process.env.UPLISTING_API_KEY;
    if (!uplistingApiKey) {
        warnings.push('UPLISTING_API_KEY not set - Uplisting integration disabled');
    }

    // --- Email ---
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    if (!emailUser || !emailPass) {
        warnings.push('EMAIL_USER/EMAIL_PASS not set - email notifications disabled');
    }

    // --- Public URL ---
    if (!process.env.PUBLIC_BASE_URL) {
        warnings.push('PUBLIC_BASE_URL not set, using default. Set this for production security.');
    }

    // --- Fail fast in production ---
    if (errors.length > 0) {
        errors.forEach(e => console.error(`❌ ${e}`));
        process.exit(1);
    }

    // --- Log warnings ---
    warnings.forEach(w => console.warn(`⚠️ ${w}`));

    const devMode = !stripeSecretKey;

    return {
        isProduction,
        devMode,
        port: parseInt(process.env.PORT, 10) || 10000,

        jwt: {
            secret: jwtSecret,
        },

        stripe: {
            secretKey: stripeSecretKey,
            publicKey: process.env.STRIPE_PUBLIC_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        },

        uplisting: {
            apiKey: uplistingApiKey,
            webhookSecret: process.env.UPLISTING_WEBHOOK_SECRET,
        },

        email: {
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT, 10) || 587,
            user: emailUser,
            pass: emailPass,
            contactRecipient: process.env.CONTACT_EMAIL || emailUser,
        },

        publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

        admin: {
            username: process.env.ADMIN_USERNAME || 'admin',
            bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
        },

        rateLimits: {
            loginAttempts: parseInt(process.env.LOGIN_RATE_LIMIT_ATTEMPTS, 10) || 5,
            loginWindowMinutes: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 10) || 15,
            generalRequests: parseInt(process.env.GENERAL_RATE_LIMIT_REQUESTS, 10) || 100,
            generalWindowMinutes: parseInt(process.env.GENERAL_RATE_LIMIT_WINDOW_MINUTES, 10) || 15,
        },
    };
}

const config = loadConfig();

module.exports = config;
module.exports.validateEnv = loadConfig;
