/**
 * Migration 003: Add retry_count to failed_webhook_events
 *
 * Tracks how many times each failed webhook event has been retried,
 * allowing the system to stop retrying after 10 attempts.
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
    await dbRun(db, `ALTER TABLE failed_webhook_events ADD COLUMN retry_count INTEGER DEFAULT 0`);
};

exports.down = async function(db, isPostgres) {
    if (isPostgres) {
        await dbRun(db, `ALTER TABLE failed_webhook_events DROP COLUMN retry_count`);
    } else {
        // SQLite doesn't support DROP COLUMN before 3.35.0;
        // safe to leave column in place on rollback
        console.warn('SQLite: retry_count column left in place (DROP COLUMN not supported in older versions)');
    }
};
