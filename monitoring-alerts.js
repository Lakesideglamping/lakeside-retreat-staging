const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const EmailNotifications = require('./email-notifications.js');
require('dotenv').config();

class MonitoringAlerts {
    constructor() {
        this.emailService = new EmailNotifications();
        this.checkInterval = 5 * 60 * 1000; // 5 minutes
        this.alertThresholds = {
            diskSpace: 90, // Alert when disk usage > 90%
            memoryUsage: 85, // Alert when memory usage > 85% 
            responseTime: 5000, // Alert when response time > 5 seconds
            errorRate: 10, // Alert when error rate > 10%
            dbSize: 100 * 1024 * 1024 // Alert when DB > 100MB
        };
        this.lastAlerts = new Map(); // Track when alerts were last sent
        this.alertCooldown = 30 * 60 * 1000; // 30 minutes between same alerts
    }
    
    async checkSystemHealth() {
        console.log('🏥 Performing system health check...');
        const healthStatus = {
            timestamp: new Date().toISOString(),
            server: await this.checkServerHealth(),
            database: await this.checkDatabaseHealth(),
            storage: await this.checkStorageHealth(),
            integrations: await this.checkIntegrations()
        };
        
        return healthStatus;
    }
    
    async checkServerHealth() {
        const serverHealth = {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
            nodeVersion: process.version
        };
        
        // Check memory usage
        const memoryUsagePercent = (serverHealth.memory.heapUsed / serverHealth.memory.heapTotal) * 100;
        if (memoryUsagePercent > this.alertThresholds.memoryUsage) {
            serverHealth.status = 'warning';
            serverHealth.alerts = [`High memory usage: ${memoryUsagePercent.toFixed(1)}%`];
            
            await this.sendAlert('warning', 'High Memory Usage', {
                'Memory Usage': `${memoryUsagePercent.toFixed(1)}%`,
                'Heap Used': `${Math.round(serverHealth.memory.heapUsed / 1024 / 1024)}MB`,
                'Heap Total': `${Math.round(serverHealth.memory.heapTotal / 1024 / 1024)}MB`
            });
        }
        
        return serverHealth;
    }
    
    async checkDatabaseHealth() {
        return new Promise((resolve) => {
            const dbHealth = {
                status: 'healthy',
                connected: false,
                size: 0,
                tables: []
            };
            
            const db = new sqlite3.Database('./lakeside.db', (err) => {
                if (err) {
                    dbHealth.status = 'error';
                    dbHealth.error = err.message;
                    resolve(dbHealth);
                    return;
                }
                
                dbHealth.connected = true;
                
                // Check database file size
                try {
                    const stats = fs.statSync('./lakeside.db');
                    dbHealth.size = stats.size;
                    
                    if (stats.size > this.alertThresholds.dbSize) {
                        dbHealth.status = 'warning';
                        dbHealth.alerts = [`Database size: ${Math.round(stats.size / 1024 / 1024)}MB`];
                        
                        this.sendAlert('warning', 'Large Database Size', {
                            'Database Size': `${Math.round(stats.size / 1024 / 1024)}MB`,
                            'Threshold': `${Math.round(this.alertThresholds.dbSize / 1024 / 1024)}MB`
                        });
                    }
                } catch (fileError) {
                    dbHealth.status = 'warning';
                    dbHealth.error = 'Could not read database file stats';
                }
                
                // Check table counts
                db.get("SELECT COUNT(*) as count FROM bookings", (err, row) => {
                    if (!err) {
                        dbHealth.tables.push({ name: 'bookings', count: row.count });
                    }
                    
                    db.get("SELECT COUNT(*) as count FROM contact_messages", (err, row) => {
                        if (!err) {
                            dbHealth.tables.push({ name: 'contact_messages', count: row.count });
                        }
                        
                        db.close();
                        resolve(dbHealth);
                    });
                });
            });
        });
    }
    
    async checkStorageHealth() {
        const storageHealth = {
            status: 'healthy',
            backupDir: './backups'
        };
        
        try {
            // Check if backup directory exists
            if (fs.existsSync(storageHealth.backupDir)) {
                const files = fs.readdirSync(storageHealth.backupDir);
                storageHealth.backupCount = files.filter(f => f.endsWith('.db')).length;
                storageHealth.lastBackup = files.length > 0 ? 
                    Math.max(...files.map(f => fs.statSync(path.join(storageHealth.backupDir, f)).mtime)) : null;
                    
                // Alert if no recent backups
                const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
                if (!storageHealth.lastBackup || storageHealth.lastBackup < oneDayAgo) {
                    storageHealth.status = 'warning';
                    storageHealth.alerts = ['No recent backups found'];
                    
                    await this.sendAlert('warning', 'Missing Recent Backups', {
                        'Last Backup': storageHealth.lastBackup ? 
                            new Date(storageHealth.lastBackup).toLocaleString('en-NZ') : 'Never',
                        'Backup Count': storageHealth.backupCount || 0
                    });
                }
            } else {
                storageHealth.status = 'error';
                storageHealth.error = 'Backup directory does not exist';
            }
        } catch (error) {
            storageHealth.status = 'error';
            storageHealth.error = error.message;
        }
        
        return storageHealth;
    }
    
    async checkIntegrations() {
        const integrations = {
            stripe: {
                configured: !!process.env.STRIPE_SECRET_KEY && 
                           !process.env.STRIPE_SECRET_KEY.includes('CONFIGURE'),
                status: 'unknown'
            },
            email: {
                configured: !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS,
                status: 'unknown'
            },
            uplisting: {
                configured: !!process.env.UPLISTING_API_KEY,
                status: 'unknown'
            }
        };
        
        // Test email if configured
        if (integrations.email.configured) {
            try {
                const emailTest = await this.emailService.testEmailConfiguration();
                integrations.email.status = emailTest.success ? 'healthy' : 'error';
                integrations.email.lastTest = new Date().toISOString();
            } catch (error) {
                integrations.email.status = 'error';
                integrations.email.error = error.message;
            }
        }
        
        return integrations;
    }
    
    async sendAlert(level, message, details = {}) {
        const alertKey = `${level}-${message}`;
        const now = Date.now();
        
        // Check cooldown
        if (this.lastAlerts.has(alertKey)) {
            const lastSent = this.lastAlerts.get(alertKey);
            if (now - lastSent < this.alertCooldown) {
                console.log(`⏰ Alert '${message}' in cooldown, skipping...`);
                return;
            }
        }
        
        try {
            await this.emailService.sendSystemAlert(level, message, details);
            this.lastAlerts.set(alertKey, now);
            console.log(`🚨 Alert sent: ${level.toUpperCase()} - ${message}`);
        } catch (error) {
            console.error(`❌ Failed to send alert: ${error.message}`);
        }
    }
    
    async performHealthCheck() {
        console.log('🏥 Starting comprehensive health check...');
        
        const healthStatus = await this.checkSystemHealth();
        
        // Generate health summary
        const issues = [];
        const warnings = [];
        
        if (healthStatus.server.status !== 'healthy') {
            if (healthStatus.server.status === 'error') {
                issues.push(`Server: ${healthStatus.server.error || 'Unknown error'}`);
            } else {
                warnings.push(`Server: ${healthStatus.server.alerts?.join(', ') || 'Warning detected'}`);
            }
        }
        
        if (healthStatus.database.status !== 'healthy') {
            if (healthStatus.database.status === 'error') {
                issues.push(`Database: ${healthStatus.database.error || 'Connection failed'}`);
            } else {
                warnings.push(`Database: ${healthStatus.database.alerts?.join(', ') || 'Warning detected'}`);
            }
        }
        
        if (healthStatus.storage.status !== 'healthy') {
            if (healthStatus.storage.status === 'error') {
                issues.push(`Storage: ${healthStatus.storage.error || 'Unknown error'}`);
            } else {
                warnings.push(`Storage: ${healthStatus.storage.alerts?.join(', ') || 'Warning detected'}`);
            }
        }
        
        // Send summary alert if there are critical issues
        if (issues.length > 0) {
            await this.sendAlert('error', 'Critical System Issues Detected', {
                'Critical Issues': issues.join('; '),
                'Warnings': warnings.join('; ') || 'None'
            });
        } else if (warnings.length > 0) {
            console.log(`⚠️ Warnings detected: ${warnings.join('; ')}`);
        }
        
        console.log('✅ Health check completed');
        return healthStatus;
    }
    
    startMonitoring() {
        console.log('🚀 Starting monitoring system...');
        console.log(`⏰ Check interval: ${this.checkInterval / 1000 / 60} minutes`);
        
        // Perform initial health check
        this.performHealthCheck();
        
        // Schedule regular health checks
        const intervalId = setInterval(() => {
            this.performHealthCheck().catch(error => {
                console.error('❌ Health check failed:', error);
            });
        }, this.checkInterval);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('🛑 Shutting down monitoring system...');
            clearInterval(intervalId);
            process.exit(0);
        });
        
        console.log('✅ Monitoring system active');
        return intervalId;
    }
}

// CLI usage
if (require.main === module) {
    const monitor = new MonitoringAlerts();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'check':
            monitor.performHealthCheck();
            break;
        case 'start':
            monitor.startMonitoring();
            break;
        default:
            console.log('Usage: node monitoring-alerts.js [check|start]');
            console.log('  check - Perform single health check');
            console.log('  start - Start continuous monitoring');
    }
}

module.exports = MonitoringAlerts;