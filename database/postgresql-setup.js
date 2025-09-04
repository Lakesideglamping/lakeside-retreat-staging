#!/usr/bin/env node

/**
 * PostgreSQL Database Setup and Migration Script
 * Replaces SQLite with production-ready PostgreSQL
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class PostgreSQLMigration {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }

    async createTables() {
        const createTablesSQL = `
            -- Enable UUID extension
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            
            -- Bookings table with proper indexes
            CREATE TABLE IF NOT EXISTS bookings (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                guest_name VARCHAR(255) NOT NULL,
                guest_email VARCHAR(255) NOT NULL,
                guest_phone VARCHAR(50),
                guest_adults INTEGER DEFAULT 2,
                guest_children INTEGER DEFAULT 0,
                property_type VARCHAR(50) NOT NULL,
                checkin_date DATE NOT NULL,
                checkout_date DATE NOT NULL,
                nights INTEGER NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                payment_status VARCHAR(50) DEFAULT 'pending',
                stripe_payment_id VARCHAR(255),
                special_requests TEXT,
                booking_status VARCHAR(50) DEFAULT 'confirmed',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                
                CONSTRAINT valid_dates CHECK (checkout_date > checkin_date),
                CONSTRAINT valid_nights CHECK (nights > 0),
                CONSTRAINT valid_guests CHECK (guest_adults > 0)
            );
            
            -- Create indexes for performance
            CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(checkin_date, checkout_date);
            CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(guest_email);
            CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status);
            CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);
            CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_type);
            
            -- Reviews table
            CREATE TABLE IF NOT EXISTS reviews (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                guest_name VARCHAR(255) NOT NULL,
                guest_email VARCHAR(255) NOT NULL,
                property_stayed VARCHAR(50),
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                review_text TEXT,
                stay_date DATE,
                verified BOOLEAN DEFAULT false,
                approved BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            -- Create indexes for reviews
            CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews(approved);
            CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
            CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);
            
            -- Gift vouchers table
            CREATE TABLE IF NOT EXISTS vouchers (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                voucher_code VARCHAR(50) UNIQUE NOT NULL,
                voucher_type VARCHAR(50) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                recipient_name VARCHAR(255) NOT NULL,
                recipient_email VARCHAR(255) NOT NULL,
                purchaser_name VARCHAR(255) NOT NULL,
                purchaser_email VARCHAR(255) NOT NULL,
                personal_message TEXT,
                stripe_payment_id VARCHAR(255),
                payment_status VARCHAR(50) DEFAULT 'pending',
                voucher_status VARCHAR(50) DEFAULT 'active',
                expiry_date DATE NOT NULL,
                used_date DATE,
                used_booking_id UUID REFERENCES bookings(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            -- Create indexes for vouchers
            CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(voucher_code);
            CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(voucher_status);
            CREATE INDEX IF NOT EXISTS idx_vouchers_expiry ON vouchers(expiry_date);
            
            -- Contact messages table
            CREATE TABLE IF NOT EXISTS contact_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                subject VARCHAR(255),
                message TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'unread',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                responded_at TIMESTAMP WITH TIME ZONE
            );
            
            -- Create indexes for contact messages
            CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_messages(status);
            CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at);
            
            -- Admin sessions table (for JWT blacklist)
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_token VARCHAR(512) NOT NULL,
                admin_username VARCHAR(255) NOT NULL,
                ip_address INET,
                user_agent TEXT,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                revoked BOOLEAN DEFAULT false
            );
            
            -- Create indexes for admin sessions
            CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(session_token);
            CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_admin_sessions_username ON admin_sessions(admin_username);
            
            -- Update triggers for updated_at timestamps
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ language 'plpgsql';
            
            -- Apply update triggers
            CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
            CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
            CREATE TRIGGER update_vouchers_updated_at BEFORE UPDATE ON vouchers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `;

        try {
            await this.pool.query(createTablesSQL);
            console.log('✅ PostgreSQL tables created successfully');
            return true;
        } catch (error) {
            console.error('❌ Error creating PostgreSQL tables:', error);
            throw error;
        }
    }

    async migrateSQLiteData(sqlitePath = './lakeside.db') {
        if (!fs.existsSync(sqlitePath)) {
            console.log('ℹ️ No SQLite database found to migrate');
            return;
        }

        const sqlite3 = require('sqlite3').verbose();
        const sqliteDb = new sqlite3.Database(sqlitePath);

        return new Promise((resolve, reject) => {
            // Migrate bookings
            sqliteDb.all("SELECT * FROM bookings", async (err, rows) => {
                if (err) {
                    console.log('ℹ️ No SQLite bookings to migrate');
                    resolve();
                    return;
                }

                for (const row of rows) {
                    try {
                        await this.pool.query(`
                            INSERT INTO bookings (guest_name, guest_email, guest_phone, guest_adults, guest_children, 
                                                property_type, checkin_date, checkout_date, nights, total_amount, 
                                                payment_status, stripe_payment_id, special_requests, booking_status, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        `, [
                            row.guest_name, row.guest_email, row.guest_phone, row.guest_adults, row.guest_children,
                            row.property_type, row.checkin_date, row.checkout_date, row.nights, row.total_amount,
                            row.payment_status, row.stripe_payment_id, row.special_requests, row.booking_status, 
                            row.created_at || new Date()
                        ]);
                        console.log(`✅ Migrated booking for ${row.guest_name}`);
                    } catch (error) {
                        console.error(`❌ Error migrating booking for ${row.guest_name}:`, error.message);
                    }
                }
                resolve();
            });
        });
    }

    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW()');
            console.log('✅ PostgreSQL connection successful:', result.rows[0]);
            return true;
        } catch (error) {
            console.error('❌ PostgreSQL connection failed:', error);
            return false;
        }
    }

    async close() {
        await this.pool.end();
    }
}

// CLI usage
if (require.main === module) {
    console.log('🐘 PostgreSQL Migration Tool');
    console.log('============================\n');

    const migration = new PostgreSQLMigration();

    async function runMigration() {
        try {
            // Test connection
            const connected = await migration.testConnection();
            if (!connected) {
                console.error('❌ Cannot connect to PostgreSQL. Please check DATABASE_URL environment variable.');
                process.exit(1);
            }

            // Create tables
            await migration.createTables();

            // Migrate existing data
            await migration.migrateSQLiteData();

            console.log('\n🎉 PostgreSQL migration completed successfully!');
            console.log('\n📋 Next steps:');
            console.log('   1. Update your server to use PostgreSQL instead of SQLite');
            console.log('   2. Test all booking functionality');
            console.log('   3. Remove SQLite dependency from package.json');
            console.log('   4. Update backup scripts for PostgreSQL');

        } catch (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        } finally {
            await migration.close();
        }
    }

    runMigration();
}

module.exports = PostgreSQLMigration;