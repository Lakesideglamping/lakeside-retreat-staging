/**
 * Migration 009: Fix marketing automation tables
 *
 * Ensures `abandoned_checkout_reminders` and `review_requests` tables exist
 * with all required columns. These tables are normally created by
 * MarketingAutomation.createTables(), but if that initialisation failed
 * (e.g. on a fresh PostgreSQL deployment) the columns may be missing,
 * causing getAbandonedCheckouts() to return 500.
 *
 * Uses IF NOT EXISTS / DO NOTHING patterns so it is safe to re-run.
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
        // Create table if it doesn't exist at all
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS abandoned_checkout_reminders (
                id SERIAL PRIMARY KEY,
                booking_id TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_name TEXT,
                accommodation TEXT,
                check_in TEXT,
                check_out TEXT,
                reminder_count INTEGER DEFAULT 0,
                last_reminder_sent_at TEXT,
                last_error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(booking_id)
            )
        `);

        // Idempotently add columns that may be missing from older schema
        const columns = [
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS guest_name TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS accommodation TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS check_in TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS check_out TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS last_reminder_sent_at TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN IF NOT EXISTS last_error TEXT`,
        ];
        for (const sql of columns) {
            await dbRun(db, sql);
        }

        // Same for review_requests
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS review_requests (
                id SERIAL PRIMARY KEY,
                booking_id TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_name TEXT,
                accommodation TEXT,
                check_out TEXT,
                request_count INTEGER DEFAULT 0,
                last_request_sent_at TEXT,
                last_error TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(booking_id)
            )
        `);

        const reviewColumns = [
            `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS guest_name TEXT`,
            `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS accommodation TEXT`,
            `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS check_out TEXT`,
            `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS last_error TEXT`,
        ];
        for (const sql of reviewColumns) {
            await dbRun(db, sql);
        }

        // social_content_drafts table
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS social_content_drafts (
                id SERIAL PRIMARY KEY,
                platform TEXT NOT NULL,
                source_type TEXT,
                source_text TEXT,
                accommodation TEXT,
                generated_caption TEXT,
                hashtags TEXT,
                story_text TEXT,
                status TEXT DEFAULT 'draft',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

    } else {
        // SQLite
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS abandoned_checkout_reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_name TEXT,
                accommodation TEXT,
                check_in TEXT,
                check_out TEXT,
                reminder_count INTEGER DEFAULT 0,
                last_reminder_sent_at TEXT,
                last_error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(booking_id)
            )
        `);

        // SQLite uses "duplicate column" errors — ignore them
        const sqCols = [
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN guest_name TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN accommodation TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN check_in TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN check_out TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN last_reminder_sent_at TEXT`,
            `ALTER TABLE abandoned_checkout_reminders ADD COLUMN last_error TEXT`,
        ];
        for (const sql of sqCols) {
            await dbRun(db, sql).catch(() => {});
        }

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS review_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_name TEXT,
                accommodation TEXT,
                check_out TEXT,
                request_count INTEGER DEFAULT 0,
                last_request_sent_at TEXT,
                last_error TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(booking_id)
            )
        `);

        const rqCols = [
            `ALTER TABLE review_requests ADD COLUMN guest_name TEXT`,
            `ALTER TABLE review_requests ADD COLUMN accommodation TEXT`,
            `ALTER TABLE review_requests ADD COLUMN check_out TEXT`,
            `ALTER TABLE review_requests ADD COLUMN last_error TEXT`,
        ];
        for (const sql of rqCols) {
            await dbRun(db, sql).catch(() => {});
        }

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS social_content_drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                source_type TEXT,
                source_text TEXT,
                accommodation TEXT,
                generated_caption TEXT,
                hashtags TEXT,
                story_text TEXT,
                status TEXT DEFAULT 'draft',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
};

exports.down = async function(_db, _isPostgres) {
    // Non-destructive migration — no rollback needed
};
