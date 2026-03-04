/**
 * Migration 007: Add blocked_dates table
 *
 * Allows admins to manually block out date ranges per property
 * for maintenance, personal use, cleaning, etc.
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
            CREATE TABLE IF NOT EXISTS blocked_dates (
                id         SERIAL PRIMARY KEY,
                property   TEXT NOT NULL,
                start_date DATE NOT NULL,
                end_date   DATE NOT NULL,
                reason     TEXT DEFAULT 'maintenance',
                notes      TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_blocked_dates_range ON blocked_dates (start_date, end_date)`);
    } else {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS blocked_dates (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                property   TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date   TEXT NOT NULL,
                reason     TEXT DEFAULT 'maintenance',
                notes      TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_blocked_dates_range ON blocked_dates (start_date, end_date)`);
    }
};

exports.down = async function(db) {
    await dbRun(db, 'DROP TABLE IF EXISTS blocked_dates');
};
