/**
 * Migration 005: Seed default seasonal rates
 *
 * Inserts the four standard Lakeside Retreat seasons if they don't already exist.
 * Uses INSERT WHERE NOT EXISTS so re-running this migration is safe.
 *
 * Seasons are based on Central Otago / NZ calendar (Southern Hemisphere):
 *   - Summer Peak    Dec 15 → Feb 15   +20%  (school holidays, peak demand)
 *   - Autumn/Harvest Mar 01 → May 31   +12%  (wine harvest, ideal weather)
 *   - Winter Special Jun 01 → Aug 31   -15%  (NZ winter, encourage bookings)
 *   - Spring Peak    Sep 15 → Nov 30   +10%  (shoulder season, pleasant weather)
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

// Idempotent insert — only inserts if a row with that name doesn't exist yet.
// Works for both SQLite and PostgreSQL.
function insertIfMissing(db, isPostgres, { name, start_date, end_date, multiplier, is_active }) {
    if (isPostgres) {
        return dbRun(db,
            `INSERT INTO seasonal_rates (name, start_date, end_date, multiplier, is_active, created_at, updated_at)
             SELECT $1, $2, $3, $4, $5, NOW(), NOW()
             WHERE NOT EXISTS (SELECT 1 FROM seasonal_rates WHERE name = $1)`,
            [name, start_date, end_date, multiplier, is_active ? 1 : 0]
        );
    }
    return dbRun(db,
        `INSERT INTO seasonal_rates (name, start_date, end_date, multiplier, is_active, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM seasonal_rates WHERE name = ?)`,
        [name, start_date, end_date, multiplier, is_active ? 1 : 0, name]
    );
}

const SEASONS = [
    {
        name:       'Summer Peak',
        start_date: '2026-12-15',
        end_date:   '2027-02-15',
        multiplier: 1.20,
        is_active:  true,
    },
    {
        name:       'Autumn Wine Season',
        start_date: '2026-03-01',
        end_date:   '2026-05-31',
        multiplier: 1.12,
        is_active:  true,
    },
    {
        name:       'Winter Special',
        start_date: '2026-06-01',
        end_date:   '2026-08-31',
        multiplier: 0.85,
        is_active:  true,
    },
    {
        name:       'Spring Peak',
        start_date: '2026-09-15',
        end_date:   '2026-11-30',
        multiplier: 1.10,
        is_active:  true,
    },
];

module.exports = {
    async up(db, isPostgres) {
        for (const season of SEASONS) {
            await insertIfMissing(db, isPostgres, season);
        }
    },

    async down(db, _isPostgres) {
        const names = SEASONS.map(s => s.name);
        const placeholders = names.map(() => '?').join(', ');
        await dbRun(db,
            `DELETE FROM seasonal_rates WHERE name IN (${placeholders})`,
            names
        );
    }
};
