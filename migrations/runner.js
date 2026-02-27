/**
 * Database Migration Runner
 * 
 * Runs numbered SQL migrations in order, tracking which have been applied
 * via a `schema_migrations` table. Works with both SQLite and PostgreSQL.
 * 
 * Usage:
 *   const migrate = require('./migrations/runner');
 *   await migrate(db, database);  // db = raw connection, database = abstraction
 * 
 * Migrations are .js files in this directory named NNN_description.js
 * Each exports: { up(db, isPostgres), down(db, isPostgres) }
 */

const fs = require('fs');
const path = require('path');

/**
 * Run all pending migrations.
 * @param {Object} db - Raw database connection (SQLite db or PG pool wrapper)
 * @param {Object} database - Database abstraction layer (from database.js)
 * @returns {string[]} List of migration filenames that were applied
 */
async function runMigrations(db, database) {
    const isPostgres = database.isUsingPostgres();
    
    // 1. Ensure schema_migrations table exists
    await ensureMigrationsTable(db, isPostgres);
    
    // 2. Get list of already-applied migrations
    const applied = await getAppliedMigrations(db, isPostgres);
    const appliedSet = new Set(applied);
    
    // 3. Discover migration files
    const migrationDir = __dirname;
    const files = fs.readdirSync(migrationDir)
        .filter(f => /^\d{3}_.*\.js$/.test(f))
        .sort();
    
    // 4. Run pending migrations in order
    const newlyApplied = [];
    
    for (const file of files) {
        if (appliedSet.has(file)) continue;
        
        console.log(`🔄 Running migration: ${file}`);
        const migration = require(path.join(migrationDir, file));
        
        try {
            await migration.up(db, isPostgres);
            await recordMigration(db, isPostgres, file);
            newlyApplied.push(file);
            console.log(`✅ Migration applied: ${file}`);
        } catch (err) {
            console.error(`❌ Migration failed: ${file}`, err.message);
            throw new Error(`Migration ${file} failed: ${err.message}`);
        }
    }
    
    if (newlyApplied.length === 0) {
        console.log('✅ Database schema is up to date');
    } else {
        console.log(`✅ Applied ${newlyApplied.length} migration(s)`);
    }
    
    return newlyApplied;
}

// ==========================================
// Internal helpers
// ==========================================

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

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (typeof db.all === 'function') {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        } else {
            reject(new Error('db.all not available'));
        }
    });
}

async function ensureMigrationsTable(db, isPostgres) {
    const sql = isPostgres
        ? `CREATE TABLE IF NOT EXISTS schema_migrations (
               id SERIAL PRIMARY KEY,
               filename TEXT NOT NULL UNIQUE,
               applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )`
        : `CREATE TABLE IF NOT EXISTS schema_migrations (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               filename TEXT NOT NULL UNIQUE,
               applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
           )`;
    
    await dbRun(db, sql);
}

async function getAppliedMigrations(db, isPostgres) {
    const rows = await dbAll(db, 'SELECT filename FROM schema_migrations ORDER BY filename');
    return rows.map(r => r.filename);
}

async function recordMigration(db, isPostgres, filename) {
    await dbRun(db, 'INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
}

/**
 * Rollback the last N migrations.
 * @param {Object} db - Raw database connection
 * @param {Object} database - Database abstraction layer
 * @param {number} count - Number of migrations to rollback (default: 1)
 */
async function rollbackMigrations(db, database, count = 1) {
    const isPostgres = database.isUsingPostgres();
    const applied = await getAppliedMigrations(db, isPostgres);
    const toRollback = applied.slice(-count).reverse();
    
    for (const filename of toRollback) {
        console.log(`⏪ Rolling back: ${filename}`);
        const migration = require(path.join(__dirname, filename));
        
        if (!migration.down) {
            console.warn(`⚠️  No down() in ${filename}, skipping`);
            continue;
        }
        
        try {
            await migration.down(db, isPostgres);
            await dbRun(db, 'DELETE FROM schema_migrations WHERE filename = ?', [filename]);
            console.log(`✅ Rolled back: ${filename}`);
        } catch (err) {
            console.error(`❌ Rollback failed: ${filename}`, err.message);
            throw err;
        }
    }
}

module.exports = { runMigrations, rollbackMigrations };
