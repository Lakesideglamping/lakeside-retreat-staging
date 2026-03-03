/**
 * Migration 004: Add soft-delete column to bookings table
 *
 * Changes DELETE to soft-delete by adding a deleted_at timestamp column.
 * When set, the booking is considered deleted but remains in the database
 * for audit trail purposes.
 */

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (typeof db.run === 'function') {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        } else {
            reject(new Error('db.run not available'));
        }
    });
}

module.exports = {
    async up(db, isPostgres) {
        const colType = isPostgres ? 'TIMESTAMP' : 'DATETIME';
        await dbRun(db, `ALTER TABLE bookings ADD COLUMN deleted_at ${colType} DEFAULT NULL`);
    },

    async down(db, _isPostgres) {
        // SQLite doesn't support DROP COLUMN before 3.35, but we can leave it nullable
        // For safety, this is a no-op on down
        console.log('⚠️  Cannot drop deleted_at column in SQLite < 3.35 — column will remain but be unused');
    }
};
