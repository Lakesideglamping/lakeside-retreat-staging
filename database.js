const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

let db = null;
let isPostgres = false;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const databaseUrl = process.env.DATABASE_URL;
        
        if (databaseUrl) {
            // Use PostgreSQL
            isPostgres = true;
            console.log('🐘 Connecting to PostgreSQL database...');
            
            const poolConfig = {
                connectionString: databaseUrl,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000,
            };
            
            // Add SSL config for production (Render requires SSL for external connections)
            if (process.env.NODE_ENV === 'production' || databaseUrl.includes('render.com')) {
                poolConfig.ssl = { rejectUnauthorized: false };
            }
            
            db = new Pool(poolConfig);
            
            // Test connection
            db.query('SELECT NOW()')
                .then(() => {
                    console.log('✅ Connected to PostgreSQL database');
                    // Create a wrapper that mimics SQLite API
                    const dbWrapper = createPostgresDbWrapper(db);
                    createTablesPostgres()
                        .then(() => resolve(dbWrapper))
                        .catch(reject);
                })
                .catch(err => {
                    console.error('❌ PostgreSQL connection error:', err.message);
                    reject(err);
                });
        } else {
            // Fall back to SQLite
            isPostgres = false;
            console.log('📁 Using SQLite database (set DATABASE_URL for PostgreSQL)');
            
            const dbPath = process.env.SQLITE_PATH || './lakeside.db';
            db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
                if (err) {
                    console.error('❌ SQLite connection error:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Connected to SQLite database');
                    configureSqlite();
                    createTablesSqlite()
                        .then(() => resolve(db))
                        .catch(reject);
                }
            });
        }
    });
}

function configureSqlite() {
    db.run('PRAGMA journal_mode=WAL;');
    db.run('PRAGMA synchronous=NORMAL;');
    db.run('PRAGMA cache_size=10000;');
    db.run('PRAGMA temp_store=MEMORY;');
    db.run('PRAGMA busy_timeout=30000;');
    db.run('PRAGMA foreign_keys=ON;');
    console.log('✅ SQLite optimizations applied');
}

function createTablesPostgres() {
    return new Promise(async (resolve, reject) => {
        try {
            // Create bookings table
            await db.query(`
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
            console.log('✅ Bookings table ready (PostgreSQL)');
            
            // Create contact_messages table
            await db.query(`
                CREATE TABLE IF NOT EXISTS contact_messages (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Contact messages table ready (PostgreSQL)');
            
            resolve();
        } catch (err) {
            console.error('❌ Error creating PostgreSQL tables:', err.message);
            reject(err);
        }
    });
}

function createTablesSqlite() {
    return new Promise((resolve, reject) => {
        const createBookingsTable = `
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
        `;
        
        const createContactTable = `
            CREATE TABLE IF NOT EXISTS contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        db.run(createBookingsTable, (err) => {
            if (err) {
                console.error('❌ Error creating bookings table:', err.message);
                reject(err);
            } else {
                console.log('✅ Bookings table ready (SQLite)');
                db.run(createContactTable, (err) => {
                    if (err) {
                        console.error('❌ Error creating contact table:', err.message);
                        reject(err);
                    } else {
                        console.log('✅ Contact messages table ready (SQLite)');
                        resolve();
                    }
                });
            }
        });
    });
}

// Database query wrapper - handles both SQLite and PostgreSQL
// Converts ? placeholders to $1, $2, etc. for PostgreSQL
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (isPostgres) {
            // Convert ? placeholders to $1, $2, etc.
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            db.query(pgSql, params)
                .then(result => resolve(result.rows))
                .catch(reject);
        } else {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        }
    });
}

// Get single row
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (isPostgres) {
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            db.query(pgSql, params)
                .then(result => resolve(result.rows[0] || null))
                .catch(reject);
        } else {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        }
    });
}

// Run a statement (INSERT, UPDATE, DELETE)
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (isPostgres) {
            let paramIndex = 0;
            let pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            // Add RETURNING * for INSERT/UPDATE to get affected row info
            const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
            const isUpdate = sql.trim().toUpperCase().startsWith('UPDATE');
            if ((isInsert || isUpdate) && !pgSql.toUpperCase().includes('RETURNING')) {
                pgSql += ' RETURNING *';
            }
            
            db.query(pgSql, params)
                .then(result => {
                    resolve({
                        changes: result.rowCount,
                        lastID: result.rows[0]?.id || null,
                        rows: result.rows
                    });
                })
                .catch(reject);
        } else {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({
                    changes: this.changes,
                    lastID: this.lastID
                });
            });
        }
    });
}

// Execute raw SQL (for transactions, etc.)
function exec(sql) {
    return new Promise((resolve, reject) => {
        if (isPostgres) {
            db.query(sql)
                .then(() => resolve())
                .catch(reject);
        } else {
            db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }
    });
}

// Transaction support
async function transaction(callback) {
    if (isPostgres) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await callback({
                query: (sql, params) => {
                    let paramIndex = 0;
                    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
                    return client.query(pgSql, params);
                },
                run: async (sql, params) => {
                    let paramIndex = 0;
                    let pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
                    if (!pgSql.toUpperCase().includes('RETURNING')) {
                        pgSql += ' RETURNING *';
                    }
                    const result = await client.query(pgSql, params);
                    return { changes: result.rowCount, lastID: result.rows[0]?.id };
                }
            });
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } else {
        return new Promise((resolve, reject) => {
            db.run('BEGIN IMMEDIATE TRANSACTION', async (err) => {
                if (err) return reject(err);
                try {
                    const result = await callback({
                        query: (sql, params) => query(sql, params),
                        run: (sql, params) => run(sql, params)
                    });
                    db.run('COMMIT', (err) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                } catch (err) {
                    db.run('ROLLBACK', () => reject(err));
                }
            });
        });
    }
}

// Get raw database connection (for legacy code that needs direct access)
function getDb() {
    return db;
}

function isUsingPostgres() {
    return isPostgres;
}

// Close database connection
function close() {
    return new Promise((resolve, reject) => {
        if (isPostgres) {
            db.end()
                .then(resolve)
                .catch(reject);
        } else {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        }
    });
}

// Create a wrapper object that mimics SQLite API for PostgreSQL
function createPostgresDbWrapper(pool) {
    return {
        run: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            
            // Convert ? to $1, $2, etc.
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            pool.query(pgSql, params)
                .then(result => {
                    if (callback) {
                        callback.call({ changes: result.rowCount, lastID: result.rows[0]?.id }, null);
                    }
                })
                .catch(err => {
                    console.error('PostgreSQL run error:', err.message);
                    if (callback) callback(err);
                });
        },
        
        get: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            pool.query(pgSql, params)
                .then(result => {
                    if (callback) callback(null, result.rows[0] || null);
                })
                .catch(err => {
                    console.error('PostgreSQL get error:', err.message);
                    if (callback) callback(err, null);
                });
        },
        
        all: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
            
            pool.query(pgSql, params)
                .then(result => {
                    if (callback) callback(null, result.rows);
                })
                .catch(err => {
                    console.error('PostgreSQL all error:', err.message);
                    if (callback) callback(err, []);
                });
        },
        
        serialize: function(callback) {
            if (callback) callback();
        },
        
        exec: function(sql, callback) {
            pool.query(sql)
                .then(() => { if (callback) callback(null); })
                .catch(err => { if (callback) callback(err); });
        }
    };
}

module.exports = {
    initializeDatabase,
    query,
    get,
    run,
    exec,
    transaction,
    getDb,
    isUsingPostgres,
    close,
    createPostgresDbWrapper
};
