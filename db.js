const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') 
        ? { rejectUnauthorized: false } 
        : false
});

pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
});

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                guest_email TEXT NOT NULL,
                guest_phone TEXT,
                accommodation TEXT NOT NULL,
                check_in DATE NOT NULL,
                check_out DATE NOT NULL,
                guests INTEGER NOT NULL,
                total_price NUMERIC(10,2),
                status TEXT DEFAULT 'confirmed',
                payment_status TEXT DEFAULT 'pending',
                notes TEXT,
                stripe_session_id TEXT,
                stripe_payment_id TEXT,
                uplisting_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('Bookings table ready');

        await client.query(`
            CREATE TABLE IF NOT EXISTS contact_messages (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('Contact messages table ready');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_accommodation ON bookings(accommodation)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bookings_stripe_session ON bookings(stripe_session_id)
        `);
        console.log('Database indexes ready');

    } finally {
        client.release();
    }
}

async function query(text, params) {
    const result = await pool.query(text, params);
    return result;
}

async function getOne(text, params) {
    const result = await pool.query(text, params);
    return result.rows[0] || null;
}

async function getAll(text, params) {
    const result = await pool.query(text, params);
    return result.rows;
}

async function run(text, params) {
    const result = await pool.query(text, params);
    return {
        rowCount: result.rowCount,
        rows: result.rows
    };
}

async function healthCheck() {
    try {
        const result = await pool.query('SELECT 1');
        return result.rows.length > 0;
    } catch (err) {
        console.error('Database health check failed:', err);
        return false;
    }
}

module.exports = {
    pool,
    initializeDatabase,
    query,
    getOne,
    getAll,
    run,
    healthCheck
};
