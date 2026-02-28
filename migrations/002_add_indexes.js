/**
 * Migration 002: Add performance indexes
 * 
 * db.js had these indexes but database.js didn't. Consolidating them here
 * so both SQLite and PostgreSQL get the same indexes.
 */

function dbRun(db, sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, [], function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

exports.up = async function(db, _isPostgres) {
    // Booking lookup indexes
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_accommodation ON bookings(accommodation)`);
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status)`);
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_stripe_session ON bookings(stripe_session_id)`);
    
    // Date range queries (availability checks, calendar, admin filtering)
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out)`);
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`);
    
    // Admin booking list (sorted by creation date)
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at)`);
    
    // Contact messages (admin list sorted by date)
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at)`);
    
    // System settings key lookup
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(setting_key)`);
};

exports.down = async function(db, _isPostgres) {
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_accommodation`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_payment_status`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_stripe_session`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_dates`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_status`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_bookings_created`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_contact_created`);
    await dbRun(db, `DROP INDEX IF EXISTS idx_settings_key`);
};
