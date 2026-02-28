/**
 * Migration 001: Baseline schema
 * 
 * Captures the existing schema as the starting point for migrations.
 * All statements use IF NOT EXISTS so this is safe to run against
 * databases that already have these tables.
 */

require('util');

function dbRun(db, sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, [], function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

exports.up = async function(db, isPostgres) {
    if (isPostgres) {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_phone TEXT,
                accommodation TEXT NOT NULL,
                check_in DATE NOT NULL,
                check_out DATE NOT NULL,
                guests INTEGER NOT NULL,
                total_price DECIMAL(10,2),
                status TEXT DEFAULT 'confirmed',
                payment_status TEXT DEFAULT 'pending',
                notes TEXT,
                stripe_session_id TEXT,
                stripe_payment_id TEXT,
                security_deposit_amount DECIMAL(10,2) DEFAULT 350.00,
                security_deposit_intent_id TEXT,
                security_deposit_status TEXT DEFAULT 'pending',
                security_deposit_released_at TIMESTAMP,
                security_deposit_claimed_amount DECIMAL(10,2) DEFAULT 0,
                uplisting_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS contact_messages (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS seasonal_rates (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                multiplier DECIMAL(3,2) DEFAULT 1.00,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS gallery_images (
                id SERIAL PRIMARY KEY,
                filename TEXT NOT NULL,
                title TEXT,
                description TEXT,
                property TEXT,
                is_hero BOOLEAN DEFAULT false,
                is_featured BOOLEAN DEFAULT false,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                guest_name TEXT NOT NULL,
                platform TEXT DEFAULT 'direct',
                rating INTEGER DEFAULT 5,
                review_text TEXT,
                stay_date DATE,
                property TEXT,
                status TEXT DEFAULT 'pending',
                is_featured BOOLEAN DEFAULT false,
                admin_notes TEXT,
                admin_response TEXT,
                response_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS system_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                setting_type TEXT DEFAULT 'string',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    } else {
        // SQLite
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_phone TEXT,
                accommodation TEXT NOT NULL,
                check_in DATE NOT NULL,
                check_out DATE NOT NULL,
                guests INTEGER NOT NULL,
                total_price DECIMAL(10,2),
                status TEXT DEFAULT 'confirmed',
                payment_status TEXT DEFAULT 'pending',
                notes TEXT,
                stripe_session_id TEXT,
                stripe_payment_id TEXT,
                security_deposit_amount DECIMAL(10,2) DEFAULT 350.00,
                security_deposit_intent_id TEXT,
                security_deposit_status TEXT DEFAULT 'pending',
                security_deposit_released_at DATETIME,
                security_deposit_claimed_amount DECIMAL(10,2) DEFAULT 0,
                uplisting_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS seasonal_rates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                multiplier DECIMAL(3,2) DEFAULT 1.00,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS gallery_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                title TEXT,
                description TEXT,
                property TEXT,
                is_hero INTEGER DEFAULT 0,
                is_featured INTEGER DEFAULT 0,
                display_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guest_name TEXT NOT NULL,
                platform TEXT DEFAULT 'direct',
                rating INTEGER DEFAULT 5,
                review_text TEXT,
                stay_date DATE,
                property TEXT,
                status TEXT DEFAULT 'pending',
                is_featured INTEGER DEFAULT 0,
                admin_notes TEXT,
                admin_response TEXT,
                response_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                setting_type TEXT DEFAULT 'string',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
};

exports.down = async function(_db, _isPostgres) {
    // Baseline migration cannot be rolled back safely
    console.warn('⚠️  Cannot rollback baseline migration — would destroy all data');
};
