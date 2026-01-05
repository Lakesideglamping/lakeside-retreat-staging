const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
require('dotenv').config();

class BackupSystem {
    constructor() {
        this.backupDir = './backups';
        this.maxBackups = 30; // Keep 30 days of backups
        
        // Create backup directory if it doesn't exist
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
        
        // Email transporter for notifications
        this.emailTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }
    
    async createDatabaseBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFileName = `lakeside-backup-${timestamp}.db`;
            const backupPath = path.join(this.backupDir, backupFileName);
            
            console.log('🗄️ Starting database backup...');
            
            // Copy SQLite database file
            await fs.promises.copyFile('./lakeside.db', backupPath);
            
            // Get backup file size
            const stats = await fs.promises.stat(backupPath);
            const fileSizeKB = Math.round(stats.size / 1024);
            
            console.log(`✅ Database backup created: ${backupFileName} (${fileSizeKB}KB)`);
            
            return {
                success: true,
                fileName: backupFileName,
                size: fileSizeKB,
                path: backupPath
            };
            
        } catch (error) {
            console.error('❌ Database backup failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async createFullSystemBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFileName = `system-backup-${timestamp}.json`;
            const backupPath = path.join(this.backupDir, backupFileName);
            
            console.log('📦 Starting full system backup...');
            
            // Get database statistics
            const dbStats = await this.getDatabaseStats();
            
            // Create backup manifest
            const backupData = {
                timestamp: new Date().toISOString(),
                version: '1.0.1',
                database: {
                    file: 'lakeside.db',
                    stats: dbStats
                },
                files: {
                    server: 'server.js',
                    frontend: 'index.html',
                    admin: [
                        'admin.html',
                        'admin-dashboard.html', 
                        'admin-analytics.html',
                        'admin-bookings.html',
                        'admin-reviews.html'
                    ],
                    config: ['package.json', 'render.yaml'],
                    serviceWorker: 'sw.js'
                },
                environment: {
                    nodeVersion: process.version,
                    platform: process.platform
                }
            };
            
            // Write backup manifest
            await fs.promises.writeFile(backupPath, JSON.stringify(backupData, null, 2));
            
            console.log(`✅ System backup manifest created: ${backupFileName}`);
            
            return {
                success: true,
                fileName: backupFileName,
                data: backupData
            };
            
        } catch (error) {
            console.error('❌ System backup failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async getDatabaseStats() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database('./lakeside.db', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const stats = {};
                
                // Count bookings
                db.get('SELECT COUNT(*) as count FROM bookings', (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    stats.totalBookings = row.count;
                    
                    // Count contact messages
                    db.get('SELECT COUNT(*) as count FROM contact_messages', (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        stats.totalContacts = row.count;
                        
                        // Get date range
                        db.get('SELECT MIN(created_at) as first, MAX(created_at) as last FROM bookings', (err, row) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            stats.dateRange = {
                                first: row.first,
                                last: row.last
                            };
                            
                            db.close();
                            resolve(stats);
                        });
                    });
                });
            });
        });
    }
    
    async cleanupOldBackups() {
        try {
            const files = await fs.promises.readdir(this.backupDir);
            const backupFiles = files
                .filter(file => file.startsWith('lakeside-backup-') && file.endsWith('.db'))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    stat: fs.statSync(path.join(this.backupDir, file))
                }))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);
                
            if (backupFiles.length > this.maxBackups) {
                const filesToDelete = backupFiles.slice(this.maxBackups);
                
                for (const file of filesToDelete) {
                    await fs.promises.unlink(file.path);
                    console.log(`🗑️ Deleted old backup: ${file.name}`);
                }
                
                console.log(`✅ Cleanup complete: ${filesToDelete.length} old backups removed`);
            }
            
        } catch (error) {
            console.error('❌ Backup cleanup failed:', error);
        }
    }
    
    async sendBackupNotification(dbBackup, systemBackup) {
        if (!process.env.EMAIL_USER || !this.emailTransporter) {
            console.log('📧 Email not configured - skipping backup notification');
            return;
        }
        
        try {
            const subject = `Lakeside Retreat - Automated Backup Complete`;
            const html = `
                <h2>🛡️ Automated Backup Report</h2>
                <p><strong>Backup Date:</strong> ${new Date().toLocaleString('en-NZ')}</p>
                
                <h3>Database Backup</h3>
                <ul>
                    <li><strong>Status:</strong> ${dbBackup.success ? '✅ Success' : '❌ Failed'}</li>
                    ${dbBackup.success ? `
                        <li><strong>File:</strong> ${dbBackup.fileName}</li>
                        <li><strong>Size:</strong> ${dbBackup.size}KB</li>
                    ` : `
                        <li><strong>Error:</strong> ${dbBackup.error}</li>
                    `}
                </ul>
                
                <h3>System Backup</h3>
                <ul>
                    <li><strong>Status:</strong> ${systemBackup.success ? '✅ Success' : '❌ Failed'}</li>
                    ${systemBackup.success ? `
                        <li><strong>File:</strong> ${systemBackup.fileName}</li>
                        <li><strong>Total Bookings:</strong> ${systemBackup.data.database.stats.totalBookings}</li>
                        <li><strong>Contact Messages:</strong> ${systemBackup.data.database.stats.totalContacts}</li>
                    ` : `
                        <li><strong>Error:</strong> ${systemBackup.error}</li>
                    `}
                </ul>
                
                <hr>
                <p><small>Lakeside Retreat Automated Backup System</small></p>
            `;
            
            await this.emailTransporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.BACKUP_EMAIL || process.env.EMAIL_USER,
                subject: subject,
                html: html
            });
            
            console.log('✅ Backup notification sent successfully');
            
        } catch (error) {
            console.error('❌ Failed to send backup notification:', error);
        }
    }
    
    async performBackup() {
        console.log('🚀 Starting automated backup process...');
        
        // Create database backup
        const dbBackup = await this.createDatabaseBackup();
        
        // Create system backup
        const systemBackup = await this.createFullSystemBackup();
        
        // Cleanup old backups
        await this.cleanupOldBackups();
        
        // Send notification
        await this.sendBackupNotification(dbBackup, systemBackup);
        
        console.log('🏁 Backup process complete!');
        
        return {
            database: dbBackup,
            system: systemBackup
        };
    }
    
    scheduleBackups() {
        // Daily backup at 2 AM
        const scheduleDaily = () => {
            const now = new Date();
            const backup = new Date(now);
            backup.setHours(2, 0, 0, 0);
            
            // If 2 AM today has passed, schedule for tomorrow
            if (backup <= now) {
                backup.setDate(backup.getDate() + 1);
            }
            
            const msUntilBackup = backup.getTime() - now.getTime();
            
            setTimeout(() => {
                this.performBackup();
                // Schedule next backup
                setInterval(() => this.performBackup(), 24 * 60 * 60 * 1000); // Every 24 hours
            }, msUntilBackup);
            
            console.log(`⏰ Next backup scheduled for: ${backup.toLocaleString('en-NZ')}`);
        };
        
        scheduleDaily();
    }
}

// CLI usage
if (require.main === module) {
    const backup = new BackupSystem();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'create':
            backup.performBackup();
            break;
        case 'schedule':
            backup.scheduleBackups();
            break;
        default:
            console.log('Usage: node backup-system.js [create|schedule]');
            console.log('  create   - Perform backup now');
            console.log('  schedule - Start automated daily backups');
    }
}

module.exports = BackupSystem;