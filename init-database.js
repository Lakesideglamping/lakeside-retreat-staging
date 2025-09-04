#!/usr/bin/env node

/**
 * Database Initialization Script
 * Creates SQLite database with all required tables
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'lakeside.db');

console.log('🗄️  Initializing Lakeside Retreat Database...\n');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Failed to create database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to SQLite database:', DB_PATH);
});

// Create tables
db.serialize(() => {
    // Bookings table
    db.run(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create bookings table:', err);
        else console.log('✅ Created bookings table');
    });

    // Pricing table
    db.run(`
        CREATE TABLE IF NOT EXISTS pricing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accommodation TEXT NOT NULL UNIQUE,
            base_price DECIMAL(10,2) NOT NULL,
            weekend_price DECIMAL(10,2),
            peak_season_price DECIMAL(10,2),
            min_nights INTEGER DEFAULT 2,
            cleaning_fee DECIMAL(10,2) DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create pricing table:', err);
        else console.log('✅ Created pricing table');
    });

    // Reviews table
    db.run(`
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guest_name TEXT NOT NULL,
            accommodation TEXT NOT NULL,
            rating INTEGER NOT NULL,
            review_text TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            published_at DATETIME
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create reviews table:', err);
        else console.log('✅ Created reviews table');
    });

    // Admin sessions table
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create admin_sessions table:', err);
        else console.log('✅ Created admin_sessions table');
    });

    // Content table for website content management
    db.run(`
        CREATE TABLE IF NOT EXISTS content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section TEXT NOT NULL UNIQUE,
            title TEXT,
            content TEXT,
            metadata TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create content table:', err);
        else console.log('✅ Created content table');
    });

    // Gallery table
    db.run(`
        CREATE TABLE IF NOT EXISTS gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            category TEXT,
            display_order INTEGER,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Failed to create gallery table:', err);
        else console.log('✅ Created gallery table');
    });

    // Insert default pricing
    const defaultPricing = [
        ['Dome Pinot', 295, 325, 350, 2, 50],
        ['Dome Rosé', 295, 325, 350, 2, 50],
        ['Lakeside Cottage', 245, 275, 300, 2, 50]
    ];

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO pricing (accommodation, base_price, weekend_price, peak_season_price, min_nights, cleaning_fee)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    defaultPricing.forEach(row => {
        stmt.run(row, (err) => {
            if (err) console.error('❌ Failed to insert pricing:', err);
        });
    });
    stmt.finalize();

    console.log('✅ Inserted default pricing data');

    // Insert sample content
    db.run(`
        INSERT OR REPLACE INTO content (section, title, content)
        VALUES 
        ('hero', 'Lake Dunstan Meets Wine Country Magic', 'New Zealand''s first energy-positive accommodation experience'),
        ('about', 'About Lakeside Retreat', 'Experience sustainable luxury at its finest')
    `, (err) => {
        if (!err) console.log('✅ Inserted default content');
    });
});

// Close database
db.close((err) => {
    if (err) {
        console.error('❌ Error closing database:', err);
    } else {
        console.log('\n✅ Database initialization complete!');
        console.log('📍 Database location:', DB_PATH);
    }
});