/**
 * Secure Configuration Management
 * Centralized config with validation, type checking, and security
 */

const path = require('path');

class ConfigManager {
    constructor() {
        this.config = this.loadConfiguration();
        this.validateConfiguration();
    }

    loadConfiguration() {
        // Load environment-specific config
        const env = process.env.NODE_ENV || 'development';
        
        return {
            // Server Configuration
            server: {
                port: this.getNumber('PORT', 10000),
                host: this.getString('HOST', '0.0.0.0'),
                nodeEnv: this.getString('NODE_ENV', 'development'),
                trustProxy: this.getBoolean('TRUST_PROXY', false),
                maxRequestSize: this.getString('MAX_REQUEST_SIZE', '10mb'),
                requestTimeout: this.getNumber('REQUEST_TIMEOUT', 30000),
            },

            // Database Configuration
            database: {
                url: this.getString('DATABASE_URL', null, true), // Required
                poolMin: this.getNumber('DB_POOL_MIN', 2),
                poolMax: this.getNumber('DB_POOL_MAX', 20),
                idleTimeout: this.getNumber('DB_IDLE_TIMEOUT', 30000),
                connectTimeout: this.getNumber('DB_CONNECT_TIMEOUT', 2000),
                acquireTimeout: this.getNumber('DB_ACQUIRE_TIMEOUT', 60000),
                statementTimeout: this.getNumber('DB_STATEMENT_TIMEOUT', 30000),
                queryTimeout: this.getNumber('DB_QUERY_TIMEOUT', 30000),
            },

            // Security Configuration
            security: {
                jwtSecret: this.getString('JWT_SECRET', null, true), // Required
                jwtExpiry: this.getString('JWT_EXPIRY', '1h'),
                sessionSecret: this.getString('SESSION_SECRET', null, true), // Required
                sessionTimeout: this.getNumber('SESSION_TIMEOUT_MINUTES', 60),
                bcryptRounds: this.getNumber('BCRYPT_ROUNDS', 12),
                secureCookies: this.getBoolean('SECURE_COOKIES', env === 'production'),
                httpsOnly: this.getBoolean('HTTPS_ONLY', env === 'production'),
                csrfProtection: this.getBoolean('CSRF_PROTECTION', true),
            },

            // Admin Configuration
            admin: {
                username: this.getString('ADMIN_USERNAME', null, true), // Required
                passwordHash: this.getString('ADMIN_PASSWORD_HASH', null, true), // Required
                maxLoginAttempts: this.getNumber('MAX_LOGIN_ATTEMPTS', 5),
                lockoutDuration: this.getNumber('LOCKOUT_DURATION_MINUTES', 15),
            },

            // Rate Limiting Configuration
            rateLimiting: {
                loginAttempts: this.getNumber('LOGIN_RATE_LIMIT_ATTEMPTS', 3),
                loginWindow: this.getNumber('LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15),
                generalRequests: this.getNumber('GENERAL_RATE_LIMIT_REQUESTS', 50),
                generalWindow: this.getNumber('GENERAL_RATE_LIMIT_WINDOW_MINUTES', 15),
                strictMode: this.getBoolean('RATE_LIMIT_STRICT_MODE', env === 'production'),
            },

            // Logging Configuration
            logging: {
                level: this.getString('LOG_LEVEL', env === 'production' ? 'warn' : 'info'),
                dir: this.getString('LOG_DIR', './logs'),
                maxSize: this.getString('LOG_MAX_SIZE', '10MB'),
                maxFiles: this.getNumber('LOG_MAX_FILES', 5),
                enableConsole: this.getBoolean('LOG_ENABLE_CONSOLE', env !== 'production'),
                enableFile: this.getBoolean('LOG_ENABLE_FILE', true),
                sensitiveFields: this.getArray('LOG_SENSITIVE_FIELDS', [
                    'password', 'token', 'secret', 'key', 'card', 'cvv', 'ssn'
                ]),
                externalService: {
                    enabled: this.getBoolean('EXTERNAL_LOGGING_ENABLED', false),
                    token: this.getString('LOGTAIL_TOKEN', null),
                    endpoint: this.getString('LOG_EXTERNAL_ENDPOINT', null),
                }
            },

            // Email Configuration
            email: {
                host: this.getString('EMAIL_HOST', null),
                port: this.getNumber('EMAIL_PORT', 587),
                secure: this.getBoolean('EMAIL_SECURE', false),
                user: this.getString('EMAIL_USER', null),
                pass: this.getString('EMAIL_PASS', null),
                from: this.getString('FROM_EMAIL', null),
                timeout: this.getNumber('EMAIL_TIMEOUT', 10000),
                retryAttempts: this.getNumber('EMAIL_RETRY_ATTEMPTS', 3),
            },

            // Payment Configuration (Stripe)
            payment: {
                stripeSecretKey: this.getString('STRIPE_SECRET_KEY', null),
                stripeWebhookSecret: this.getString('STRIPE_WEBHOOK_SECRET', null),
                currency: this.getString('PAYMENT_CURRENCY', 'nzd'),
                successUrl: this.getString('PAYMENT_SUCCESS_URL', null),
                cancelUrl: this.getString('PAYMENT_CANCEL_URL', null),
                allowedOrigins: this.getArray('PAYMENT_ALLOWED_ORIGINS', ['https://lakesideretreat.co.nz']),
            },

            // SSL/TLS Configuration
            ssl: {
                enabled: this.getBoolean('SSL_ENABLED', env === 'production'),
                keyPath: this.getString('SSL_KEY_PATH', './ssl/private.key'),
                certPath: this.getString('SSL_CERT_PATH', './ssl/certificate.crt'),
                caPath: this.getString('SSL_CA_PATH', './ssl/ca_bundle.crt'),
                minVersion: this.getString('SSL_MIN_VERSION', 'TLSv1.2'),
            },

            // Monitoring Configuration
            monitoring: {
                enabled: this.getBoolean('MONITORING_ENABLED', true),
                healthCheckPath: this.getString('HEALTH_CHECK_PATH', '/api/health'),
                metricsPath: this.getString('METRICS_PATH', '/api/metrics'),
                secret: this.getString('MONITORING_SECRET', null),
                alertWebhook: this.getString('ALERT_WEBHOOK_URL', null),
                alertEmail: this.getString('ALERT_EMAIL', null),
            },

            // Backup Configuration
            backup: {
                enabled: this.getBoolean('BACKUP_ENABLED', env === 'production'),
                schedule: this.getString('BACKUP_SCHEDULE', '0 2 * * *'), // 2 AM daily
                retentionDays: this.getNumber('BACKUP_RETENTION_DAYS', 30),
                location: this.getString('BACKUP_LOCATION', './backups'),
                compression: this.getBoolean('BACKUP_COMPRESSION', true),
                encryption: this.getBoolean('BACKUP_ENCRYPTION', env === 'production'),
            },

            // Feature Flags
            features: {
                vouchersEnabled: this.getBoolean('FEATURE_VOUCHERS', true),
                reviewsEnabled: this.getBoolean('FEATURE_REVIEWS', true),
                contactFormEnabled: this.getBoolean('FEATURE_CONTACT_FORM', true),
                analyticsEnabled: this.getBoolean('FEATURE_ANALYTICS', true),
                maintenanceMode: this.getBoolean('MAINTENANCE_MODE', false),
            },
        };
    }

    validateConfiguration() {
        const errors = [];

        // Critical validations
        if (!this.config.database.url) {
            errors.push('DATABASE_URL is required');
        }

        if (!this.config.security.jwtSecret || this.config.security.jwtSecret.length < 32) {
            errors.push('JWT_SECRET must be at least 32 characters long');
        }

        if (!this.config.security.sessionSecret || this.config.security.sessionSecret.length < 16) {
            errors.push('SESSION_SECRET must be at least 16 characters long');
        }

        if (!this.config.admin.username || !this.config.admin.passwordHash) {
            errors.push('Admin credentials (ADMIN_USERNAME and ADMIN_PASSWORD_HASH) are required');
        }

        // Production-specific validations
        if (this.config.server.nodeEnv === 'production') {
            if (!this.config.security.secureCookies) {
                errors.push('SECURE_COOKIES must be enabled in production');
            }

            if (!this.config.security.httpsOnly) {
                errors.push('HTTPS_ONLY must be enabled in production');
            }

            if (this.config.logging.level === 'debug') {
                errors.push('Log level should not be debug in production');
            }

            if (!this.config.ssl.enabled) {
                console.warn('⚠️  SSL is not enabled in production mode');
            }
        }

        if (errors.length > 0) {
            console.error('❌ Configuration validation failed:');
            errors.forEach(error => console.error(`   • ${error}`));
            throw new Error('Invalid configuration');
        }

        console.log(`✅ Configuration validated for ${this.config.server.nodeEnv} environment`);
    }

    // Helper methods for type-safe environment variable access
    getString(key, defaultValue = null, required = false) {
        const value = process.env[key];
        
        if (required && !value) {
            throw new Error(`Environment variable ${key} is required`);
        }
        
        return value || defaultValue;
    }

    getNumber(key, defaultValue = 0, required = false) {
        const value = process.env[key];
        
        if (required && !value) {
            throw new Error(`Environment variable ${key} is required`);
        }
        
        if (!value) return defaultValue;
        
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Environment variable ${key} must be a valid number`);
        }
        
        return parsed;
    }

    getBoolean(key, defaultValue = false, required = false) {
        const value = process.env[key];
        
        if (required && !value) {
            throw new Error(`Environment variable ${key} is required`);
        }
        
        if (!value) return defaultValue;
        
        return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }

    getArray(key, defaultValue = [], separator = ',') {
        const value = process.env[key];
        
        if (!value) return defaultValue;
        
        return value.split(separator).map(item => item.trim()).filter(Boolean);
    }

    // Get configuration section
    get(section = null) {
        if (!section) return this.config;
        
        if (!this.config[section]) {
            throw new Error(`Configuration section '${section}' not found`);
        }
        
        return this.config[section];
    }

    // Check if running in development
    isDevelopment() {
        return this.config.server.nodeEnv === 'development';
    }

    // Check if running in production
    isProduction() {
        return this.config.server.nodeEnv === 'production';
    }

    // Check if running in test
    isTest() {
        return this.config.server.nodeEnv === 'test';
    }
}

// Singleton instance
let configInstance = null;

function getConfig() {
    if (!configInstance) {
        configInstance = new ConfigManager();
    }
    return configInstance;
}

module.exports = {
    getConfig,
    ConfigManager
};