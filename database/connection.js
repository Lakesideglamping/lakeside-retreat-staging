/**
 * Production-Ready Database Connection Pool
 * PostgreSQL with connection pooling, error handling, and monitoring
 */

const { Pool } = require('pg');

class DatabaseConnection {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
        
        this.initializePool();
    }

    initializePool() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            
            // Connection pool settings
            max: parseInt(process.env.DB_POOL_MAX || '20'),
            min: parseInt(process.env.DB_POOL_MIN || '2'),
            idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
            connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '2000'),
            acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT || '60000'),
            
            // Query settings
            statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
            query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'),
        });

        // Handle pool events
        this.pool.on('connect', (client) => {
            console.log('✅ New PostgreSQL client connected');
            this.isConnected = true;
            this.connectionAttempts = 0;
        });

        this.pool.on('error', (err) => {
            console.error('💥 Unexpected PostgreSQL pool error:', err);
            this.isConnected = false;
            this.reconnect();
        });

        this.pool.on('acquire', () => {
            console.log('🔗 Client acquired from pool');
        });

        this.pool.on('release', () => {
            console.log('🔓 Client released back to pool');
        });
    }

    async reconnect() {
        if (this.connectionAttempts >= this.maxRetries) {
            console.error('❌ Max reconnection attempts reached. Database unavailable.');
            return false;
        }

        this.connectionAttempts++;
        console.log(`🔄 Attempting to reconnect to database (${this.connectionAttempts}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, 5000 * this.connectionAttempts)); // Exponential backoff
        
        try {
            await this.testConnection();
            return true;
        } catch (error) {
            console.error('❌ Reconnection failed:', error.message);
            return this.reconnect();
        }
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release();
            this.isConnected = true;
            return true;
        } catch (error) {
            this.isConnected = false;
            throw error;
        }
    }

    async query(text, params = []) {
        const start = Date.now();
        
        try {
            if (!this.isConnected) {
                await this.testConnection();
            }

            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;
            
            // Log slow queries
            if (duration > 1000) {
                console.warn(`🐌 Slow query detected (${duration}ms):`, text.substring(0, 100));
            }
            
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            console.error(`❌ Database query failed after ${duration}ms:`, error.message);
            console.error('Query:', text.substring(0, 200));
            throw error;
        }
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getPoolStatus() {
        return {
            totalCount: this.pool.totalCount,
            idleCount: this.pool.idleCount,
            waitingCount: this.pool.waitingCount,
            isConnected: this.isConnected,
            connectionAttempts: this.connectionAttempts
        };
    }

    async healthCheck() {
        try {
            const start = Date.now();
            await this.query('SELECT 1');
            const responseTime = Date.now() - start;
            
            const poolStatus = await this.getPoolStatus();
            
            return {
                healthy: true,
                responseTime,
                pool: poolStatus,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async gracefulShutdown() {
        console.log('🔄 Closing database connection pool...');
        try {
            await this.pool.end();
            console.log('✅ Database connection pool closed successfully');
        } catch (error) {
            console.error('❌ Error closing database pool:', error);
        }
    }
}

// Singleton instance
let dbInstance = null;

function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseConnection();
    }
    return dbInstance;
}

module.exports = {
    getDatabase,
    DatabaseConnection
};