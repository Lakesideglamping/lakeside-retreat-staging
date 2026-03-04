/**
 * Migration 006: Add promo_codes table
 *
 * Supports the admin Promotions page — stores discount/promo codes
 * that can be created, paused, and deleted by the admin.
 */

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

exports.up = async function(db, isPostgres) {
    if (isPostgres) {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS promo_codes (
                id          SERIAL PRIMARY KEY,
                name        TEXT NOT NULL,
                code        TEXT NOT NULL UNIQUE,
                type        TEXT DEFAULT 'general',
                description TEXT,
                discount_type  TEXT DEFAULT 'percentage',
                discount_value DECIMAL(10,2) DEFAULT 0,
                valid_from  DATE,
                valid_until DATE,
                min_stay    INTEGER DEFAULT 1,
                usage_limit INTEGER,
                usage_count INTEGER DEFAULT 0,
                status      TEXT DEFAULT 'active',
                partner_info TEXT,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } else {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS promo_codes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                code         TEXT NOT NULL UNIQUE,
                type         TEXT DEFAULT 'general',
                description  TEXT,
                discount_type  TEXT DEFAULT 'percentage',
                discount_value REAL DEFAULT 0,
                valid_from   TEXT,
                valid_until  TEXT,
                min_stay     INTEGER DEFAULT 1,
                usage_limit  INTEGER,
                usage_count  INTEGER DEFAULT 0,
                status       TEXT DEFAULT 'active',
                partner_info TEXT,
                created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
};

exports.down = async function(db, _isPostgres) {
    await dbRun(db, 'DROP TABLE IF EXISTS promo_codes');
};
