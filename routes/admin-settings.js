/**
 * Admin Settings Routes
 * 
 * Configuration and content management:
 * - Seasonal rates CRUD (4 endpoints)
 * - Gallery management (2 endpoints)
 * - Reviews CRUD (4 endpoints)
 * - Pricing management (2 endpoints)
 * - System settings (2 endpoints)
 * - Backup management (4 endpoints)
 * - Content management (2 endpoints)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { verifyAdmin, sanitizeInput, verifyCsrf } = require('../middleware/auth');
const { logger } = require('../logger');

/**
 * @param {Object} deps
 * @param {Function} deps.db - Returns database connection
 * @param {Function} deps.ensureSystemSettingsTable - Ensure settings table exists
 * @param {Object} deps.database - Database abstraction layer
 */
function createAdminSettingsRoutes(deps) {
    const { db, ensureSystemSettingsTable, database } = deps;

router.get('/api/admin/seasonal-rates', verifyAdmin, (req, res) => {
    const sql = 'SELECT * FROM seasonal_rates ORDER BY start_date ASC';
    db().all(sql, [], (err, rows) => {
        if (err) {
            logger.error('Error fetching seasonal rates', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch seasonal rates' });
        }
        res.json({ success: true, rates: rows || [] });
    });
});

router.post('/api/admin/seasonal-rates', verifyAdmin, verifyCsrf, (req, res) => {
    const { name, start_date, end_date, multiplier, is_active } = req.body;
    
    if (!name || !start_date || !end_date) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: name, start_date, end_date'
        });
    }

    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        return res.status(400).json({
            success: false,
            error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD).'
        });
    }
    if (startDateObj >= endDateObj) {
        return res.status(400).json({
            success: false,
            error: 'Start date must be before end date.'
        });
    }

    const sql = `
        INSERT INTO seasonal_rates (name, start_date, end_date, multiplier, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    
    db().run(sql, [
        sanitizeInput(name),
        start_date,
        end_date,
        multiplier || 1.0,
        is_active !== false ? 1 : 0
    ], function(err) {
        if (err) {
            logger.error('Error creating seasonal rate', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to create seasonal rate' });
        }
        res.json({
            success: true,
            rate: {
                id: this.lastID,
                name,
                start_date,
                end_date,
                multiplier: multiplier || 1.0,
                is_active: is_active !== false
            }
        });
    });
});

router.put('/api/admin/seasonal-rates/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const { id } = req.params;
    const { name, start_date, end_date, multiplier, is_active } = req.body;

    // Validate dates
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        return res.status(400).json({
            success: false,
            error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD).'
        });
    }
    if (startDateObj >= endDateObj) {
        return res.status(400).json({
            success: false,
            error: 'Start date must be before end date.'
        });
    }

    const sql = `
        UPDATE seasonal_rates 
        SET name = ?, start_date = ?, end_date = ?, multiplier = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db().run(sql, [
        sanitizeInput(name),
        start_date,
        end_date,
        multiplier || 1.0,
        is_active ? 1 : 0,
        id
    ], function(err) {
        if (err) {
            logger.error('Error updating seasonal rate', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to update seasonal rate' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Seasonal rate not found' });
        }
        res.json({ success: true, message: 'Seasonal rate updated' });
    });
});

router.delete('/api/admin/seasonal-rates/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const { id } = req.params;
    
    db().run('DELETE FROM seasonal_rates WHERE id = ?', [id], function(err) {
        if (err) {
            logger.error('Error deleting seasonal rate', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to delete seasonal rate' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Seasonal rate not found' });
        }
        res.json({ success: true, message: 'Seasonal rate deleted' });
    });
});

router.get('/api/admin/gallery', verifyAdmin, (req, res) => {
    const fs = require('fs');
    const imagesDir = path.join(__dirname, '..', 'public', 'images');
    
    fs.readdir(imagesDir, (err, files) => {
        if (err) {
            logger.error('Error reading images directory', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to read images' });
        }
        
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
        );
        
        const sql = 'SELECT * FROM gallery_images ORDER BY display_order ASC';
        db().all(sql, [], (err, dbImages) => {
            if (err) {
                logger.error('Error fetching gallery metadata', { error: err.message });
            }
            
            const dbImageMap = new Map((dbImages || []).map(img => [img.filename, img]));
            
            const images = imageFiles.map((filename, index) => {
                const dbData = dbImageMap.get(filename);
                let fileSizeBytes = 0;
                try {
                    fileSizeBytes = fs.statSync(path.join(imagesDir, filename)).size;
                } catch (_) { /* ignore stat errors */ }
                return {
                    id: dbData?.id || null,
                    filename,
                    url: `/images/${filename}`,
                    title: dbData?.title || filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
                    description: dbData?.description || '',
                    property: dbData?.property || 'all',
                    is_hero: dbData?.is_hero || false,
                    is_featured: dbData?.is_featured || false,
                    display_order: dbData?.display_order || index,
                    size_bytes: fileSizeBytes
                };
            });

            const totalBytes = images.reduce((sum, img) => sum + (img.size_bytes || 0), 0);

            res.json({
                success: true,
                images,
                total: images.length,
                storage_used_mb: (totalBytes / (1024 * 1024)).toFixed(2)
            });
        });
    });
});

router.put('/api/admin/gallery/:filename', verifyAdmin, verifyCsrf, (req, res) => {
    const { filename } = req.params;
    const { title, description, property, is_hero, is_featured, display_order } = req.body;
    
    const checkSql = 'SELECT id FROM gallery_images WHERE filename = ?';
    db().get(checkSql, [filename], (err, existing) => {
        if (err) {
            logger.error('Error checking gallery image', { error: err.message });
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (existing) {
            const updateSql = `
                UPDATE gallery_images 
                SET title = ?, description = ?, property = ?, is_hero = ?, is_featured = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
                WHERE filename = ?
            `;
            db().run(updateSql, [
                sanitizeInput(title || ''),
                sanitizeInput(description || ''),
                property || 'all',
                is_hero ? 1 : 0,
                is_featured ? 1 : 0,
                display_order || 0,
                filename
            ], function(err) {
                if (err) {
                    logger.error('Error updating gallery image', { error: err.message });
                    return res.status(500).json({ success: false, error: 'Failed to update image' });
                }
                res.json({ success: true, message: 'Image updated' });
            });
        } else {
            const insertSql = `
                INSERT INTO gallery_images (filename, title, description, property, is_hero, is_featured, display_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            db().run(insertSql, [
                filename,
                sanitizeInput(title || ''),
                sanitizeInput(description || ''),
                property || 'all',
                is_hero ? 1 : 0,
                is_featured ? 1 : 0,
                display_order || 0
            ], function(err) {
                if (err) {
                    logger.error('Error inserting gallery image', { error: err.message });
                    return res.status(500).json({ success: false, error: 'Failed to save image metadata' });
                }
                res.json({ success: true, message: 'Image metadata saved', id: this.lastID });
            });
        }
    });
});

router.delete('/api/admin/gallery/:filename', verifyAdmin, verifyCsrf, (req, res) => {
    const { filename } = req.params;
    const fs = require('fs');

    // Prevent path traversal — only allow safe filename characters
    if (!filename.match(/^[a-zA-Z0-9._-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    const filePath = path.join(__dirname, '..', 'public', 'images', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }

    fs.unlink(filePath, (err) => {
        if (err) {
            logger.error('Error deleting gallery image', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to delete image' });
        }
        // Best-effort: remove from gallery_images DB if the filename is tracked there
        db().run('DELETE FROM gallery_images WHERE filename = ?', [filename], () => {});
        logger.info('Gallery image deleted', { filename });
        res.json({ success: true, message: 'Image deleted' });
    });
});

// Lightweight review summary — returns counts + average rating without the full payload
router.get('/api/admin/reviews/summary', verifyAdmin, (req, res) => {
    const conn = db();
    if (!conn) return res.status(503).json({ success: false, error: 'Database not ready' });

    conn.get(
        `SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            ROUND(AVG(CASE WHEN status = 'approved' THEN rating END), 1) as average_rating
         FROM reviews`,
        (err, row) => {
            if (err) {
                logger.error('Reviews summary error', { error: err.message });
                return res.status(500).json({ success: false, error: 'Failed to load review summary' });
            }
            res.json({
                success: true,
                summary: {
                    total: row?.total || 0,
                    approved: row?.approved || 0,
                    pending: row?.pending || 0,
                    average_rating: row?.average_rating ? parseFloat(row.average_rating) : null
                }
            });
        }
    );
});

router.get('/api/admin/reviews', verifyAdmin, (req, res) => {
    const { status, platform, property } = req.query;
    let sql = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];
    
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    if (platform) {
        sql += ' AND platform = ?';
        params.push(platform);
    }
    if (property) {
        sql += ' AND property = ?';
        params.push(property);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    db().all(sql, params, (err, rows) => {
        if (err) {
            logger.error('Error fetching reviews', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
        }
        
        const reviews = rows || [];
        const stats = {
            total: reviews.length,
            pending: reviews.filter(r => r.status === 'pending').length,
            approved: reviews.filter(r => r.status === 'approved').length,
            featured: reviews.filter(r => r.is_featured).length,
            average_rating: reviews.length > 0 
                ? (reviews.reduce((sum, r) => sum + (r.rating || 5), 0) / reviews.length).toFixed(1)
                : 0
        };
        
        res.json({ success: true, reviews, stats });
    });
});

router.post('/api/admin/reviews', verifyAdmin, verifyCsrf, (req, res) => {
    const { guest_name, platform, rating, review_text, stay_date, property } = req.body;
    
    if (!guest_name) {
        return res.status(400).json({ success: false, error: 'Guest name is required' });
    }
    
    const sql = `
        INSERT INTO reviews (guest_name, platform, rating, review_text, stay_date, property, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    
    db().run(sql, [
        sanitizeInput(guest_name),
        platform || 'direct',
        rating || 5,
        sanitizeInput(review_text || ''),
        stay_date || null,
        property || null
    ], function(err) {
        if (err) {
            logger.error('Error creating review', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to create review' });
        }
        res.json({ success: true, id: this.lastID, message: 'Review created' });
    });
});

router.put('/api/admin/reviews/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const { id } = req.params;
    const { status, is_featured, admin_notes, admin_response } = req.body;
    
    let sql = 'UPDATE reviews SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    
    if (status !== undefined) {
        sql += ', status = ?';
        params.push(status);
    }
    if (is_featured !== undefined) {
        sql += ', is_featured = ?';
        params.push(is_featured ? 1 : 0);
    }
    if (admin_notes !== undefined) {
        sql += ', admin_notes = ?';
        params.push(sanitizeInput(admin_notes));
    }
    if (admin_response !== undefined) {
        sql += ', admin_response = ?, response_date = CURRENT_TIMESTAMP';
        params.push(sanitizeInput(admin_response));
    }
    
    sql += ' WHERE id = ?';
    params.push(id);
    
    db().run(sql, params, function(err) {
        if (err) {
            logger.error('Error updating review', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to update review' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Review not found' });
        }
        res.json({ success: true, message: 'Review updated' });
    });
});

router.delete('/api/admin/reviews/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const { id } = req.params;
    
    db().run('DELETE FROM reviews WHERE id = ?', [id], function(err) {
        if (err) {
            logger.error('Error deleting review', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to delete review' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Review not found' });
        }
        res.json({ success: true, message: 'Review deleted' });
    });
});

// [MOVED] Public pricing endpoint → routes/public.js
// Get all pricing data (admin)
router.get('/api/admin/pricing', verifyAdmin, (req, res) => {
    const sql = "SELECT * FROM system_settings WHERE setting_key LIKE 'pricing_%'";
    db().all(sql, [], (err, rows) => {
        if (err) {
            logger.error('Error fetching pricing', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
        }
        
        const pricing = {};
        (rows || []).forEach(row => {
            try {
                pricing[row.setting_key] = JSON.parse(row.setting_value);
            } catch (e) {
                pricing[row.setting_key] = row.setting_value;
            }
        });
        
        res.json({ success: true, pricing });
    });
});

// Save pricing for an accommodation
router.post('/api/admin/pricing', verifyAdmin, verifyCsrf, (req, res) => {
    const { accommodation, base, weekend, peak, cleaning, minNights } = req.body;
    
    if (!accommodation) {
        return res.status(400).json({ success: false, error: 'Accommodation name required' });
    }
    
    const settingKey = `pricing_${accommodation.toLowerCase().replace(/\s+/g, '_')}`;
    const pricingData = JSON.stringify({
        base: parseFloat(base) || 0,
        weekend: parseFloat(weekend) || 0,
        peak: parseFloat(peak) || 0,
        cleaning: parseFloat(cleaning) || 0,
        minNights: parseInt(minNights) || 2
    });
    
    // Ensure the table exists before attempting to save
    ensureSystemSettingsTable((tableErr) => {
        if (tableErr) {
            logger.error('Failed to ensure system_settings table', { error: tableErr.message });
            return res.status(500).json({ success: false, error: 'Database initialization failed: ' + tableErr.message });
        }
        
        // Use PostgreSQL-compatible NOW() or SQLite datetime('now')
        const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";
        const sql = `
            INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
            VALUES (?, ?, 'json', ${nowFunc})
            ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = ${nowFunc}
        `;
        
        db().run(sql, [settingKey, pricingData], function(err) {
            if (err) {
                logger.error('Error saving pricing', { error: err.message });
                return res.status(500).json({ success: false, error: 'Failed to save pricing: ' + err.message });
            }
            res.json({ success: true, message: 'Pricing saved successfully' });
        });
    });
});

router.get('/api/admin/settings', verifyAdmin, (req, res) => {
    const sql = 'SELECT * FROM system_settings';
    db().all(sql, [], (err, rows) => {
        if (err) {
            logger.error('Error fetching settings', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch settings' });
        }
        
        const settings = {};
        const sensitiveKeys = ['admin_password_hash', 'admin_2fa_secret', 'jwt_secret', 'stripe_secret'];
        (rows || []).forEach(row => {
            // Never expose sensitive keys in API response
            if (sensitiveKeys.includes(row.setting_key)) return;
            let value = row.setting_value;
            if (row.setting_type === 'boolean') {
                value = value === 'true' || value === '1';
            } else if (row.setting_type === 'number') {
                value = parseFloat(value);
            } else if (row.setting_type === 'json') {
                try { value = JSON.parse(value); } catch (e) { }
            }
            settings[row.setting_key] = value;
        });
        
        res.json({ success: true, settings });
    });
});

router.put('/api/admin/settings', verifyAdmin, verifyCsrf, (req, res) => {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'Settings object required' });
    }
    
    const BLOCKED_KEYS = ['admin_password_hash', 'admin_2fa_secret', 'jwt_secret', 'stripe_secret'];
    const entries = Object.entries(settings);

    // Check for blocked keys
    for (const [key] of entries) {
        if (BLOCKED_KEYS.includes(key?.toLowerCase())) {
            return res.status(403).json({ success: false, error: 'Cannot modify protected settings' });
        }
    }

    let completed = 0;
    const errors = [];
    
    entries.forEach(([key, value]) => {
        let settingType = 'string';
        let settingValue = String(value);
        
        if (typeof value === 'boolean') {
            settingType = 'boolean';
            settingValue = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
            settingType = 'number';
            settingValue = String(value);
        } else if (typeof value === 'object') {
            settingType = 'json';
            settingValue = JSON.stringify(value);
        }
        
        // Use PostgreSQL-compatible NOW() or SQLite datetime('now')
        const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";
        const sql = `
            INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
            VALUES (?, ?, ?, ${nowFunc})
            ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            setting_type = excluded.setting_type,
            updated_at = ${nowFunc}
        `;
        
        db().run(sql, [key, settingValue, settingType], function(err) {
            if (err) {
                errors.push({ key, error: err.message });
            }
            completed++;
            
            if (completed === entries.length) {
                if (errors.length > 0) {
                    res.status(500).json({ success: false, errors });
                } else {
                    res.json({ success: true, message: 'Settings saved' });
                }
            }
        });
    });
    
    if (entries.length === 0) {
        res.json({ success: true, message: 'No settings to save' });
    }
});

router.get('/api/admin/backups', verifyAdmin, (req, res) => {
    const fs = require('fs');
    const backupDir = './backups';
    
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.readdir(backupDir, (err, files) => {
        if (err) {
            logger.error('Error reading backups directory', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to read backups' });
        }
        
        const backups = files
            .filter(file => file.endsWith('.db') || file.endsWith('.json'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: Math.round(stats.size / 1024),
                    created_at: stats.mtime.toISOString(),
                    type: file.includes('system-backup') ? 'system' : 'database'
                };
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
        
        res.json({
            success: true,
            backups,
            stats: {
                total: backups.length,
                storage_used_kb: totalSize,
                storage_used_mb: (totalSize / 1024).toFixed(2)
            }
        });
    });
});

router.post('/api/admin/backups', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const BackupSystem = require('../backup-system');
        const backupSystem = new BackupSystem();
        
        const result = await backupSystem.performBackup();
        
        res.json({
            success: true,
            message: 'Backup created successfully',
            database: result.database,
            system: result.system
        });
    } catch (error) {
        logger.error('Error creating backup', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to create backup' });
    }
});

router.get('/api/admin/backups/:filename', verifyAdmin, (req, res) => {
    const { filename } = req.params;
    const fs = require('fs');
    const backupPath = path.join('./backups', filename);
    
    if (!filename.match(/^[a-zA-Z0-9_.-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: 'Backup not found' });
    }
    
    res.download(backupPath, filename);
});

router.delete('/api/admin/backups/:filename', verifyAdmin, verifyCsrf, (req, res) => {
    const { filename } = req.params;
    const fs = require('fs');
    const backupPath = path.join('./backups', filename);
    
    if (!filename.match(/^[a-zA-Z0-9_.-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: 'Backup not found' });
    }
    
    fs.unlink(backupPath, (err) => {
        if (err) {
            logger.error('Error deleting backup', { error: err.message });
            return res.status(500).json({ success: false, error: 'Failed to delete backup' });
        }
        res.json({ success: true, message: 'Backup deleted' });
    });
});

router.post('/api/admin/backups/restore', verifyAdmin, verifyCsrf, async (req, res) => {
    const { filename } = req.body;

    if (!filename || !filename.match(/^[a-zA-Z0-9_.-]+$/) || filename.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    const fs = require('fs');
    const backupPath = path.join('./backups', filename);

    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: 'Backup file not found' });
    }

    try {
        // For database backups, copy the backup file over the current database
        if (filename.endsWith('.db')) {
            // Validate SQLite file header before restoring
            const header = Buffer.alloc(16);
            const fd = fs.openSync(backupPath, 'r');
            fs.readSync(fd, header, 0, 16, 0);
            fs.closeSync(fd);
            if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
                return res.status(400).json({ success: false, error: 'Invalid backup file — not a valid SQLite database' });
            }

            const dbPath = process.env.SQLITE_PATH || './lakeside.db';

            // Create a safety backup of current database before overwriting
            const safetyBackupPath = path.join('./backups', `pre-restore-${Date.now()}.db`);
            try {
                if (fs.existsSync(dbPath)) {
                    fs.copyFileSync(dbPath, safetyBackupPath);
                    logger.info('Pre-restore safety backup created', { path: safetyBackupPath });
                }
            } catch (safetyErr) {
                logger.error('Failed to create pre-restore backup', { error: safetyErr.message });
                return res.status(500).json({ success: false, error: 'Cannot create safety backup before restore — aborting to protect data' });
            }

            fs.copyFileSync(backupPath, dbPath);
            res.json({ success: true, message: `Database backup restored. Safety backup saved as ${path.basename(safetyBackupPath)}. Please restart the server for changes to take effect.` });
        } else if (filename.endsWith('.json')) {
            // JSON backups contain settings/config data
            const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
            res.json({ success: true, message: 'Backup data loaded', data: backupData });
        } else {
            res.status(400).json({ success: false, error: 'Unsupported backup format' });
        }
    } catch (error) {
        logger.error('Backup restore error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to restore backup: ' + error.message });
    }
});


// ============================================================
// Promotions / Promo Codes
// ============================================================

router.get('/api/admin/promotions', verifyAdmin, (req, res) => {
    const now = new Date().toISOString().split('T')[0];
    db().all(
        `SELECT *,
            CASE
                WHEN status = 'paused' THEN 'paused'
                WHEN valid_until IS NOT NULL AND valid_until < ? THEN 'expired'
                WHEN valid_from  IS NOT NULL AND valid_from  > ? THEN 'scheduled'
                ELSE status
            END AS computed_status
         FROM promo_codes ORDER BY created_at DESC`,
        [now, now],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const codes = rows || [];
            res.json({
                success: true,
                codes,
                stats: {
                    total:      codes.length,
                    active:     codes.filter(r => r.computed_status === 'active').length,
                    scheduled:  codes.filter(r => r.computed_status === 'scheduled').length,
                    expired:    codes.filter(r => r.computed_status === 'expired').length,
                    total_uses: codes.reduce((s, r) => s + (r.usage_count || 0), 0)
                }
            });
        }
    );
});

router.post('/api/admin/promotions', verifyAdmin, verifyCsrf, (req, res) => {
    const {
        name, code, type, description,
        discount_type, discount_value,
        valid_from, valid_until, min_stay, usage_limit, partner_info
    } = req.body || {};

    if (!name || !code) {
        return res.status(400).json({ success: false, error: 'Code name and promotional code are required' });
    }
    const cleanCode = String(code).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanCode) {
        return res.status(400).json({ success: false, error: 'Invalid promotional code format' });
    }

    const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";
    db().run(
        `INSERT INTO promo_codes
             (name, code, type, description, discount_type, discount_value,
              valid_from, valid_until, min_stay, usage_limit, partner_info,
              status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',${nowFunc},${nowFunc})`,
        [
            String(name).substring(0, 100),
            cleanCode,
            ['seasonal', 'partner', 'general'].includes(type) ? type : 'general',
            description ? String(description).substring(0, 500) : null,
            ['percentage', 'fixed'].includes(discount_type) ? discount_type : 'percentage',
            parseFloat(discount_value) || 0,
            valid_from  || null,
            valid_until || null,
            parseInt(min_stay) || 1,
            usage_limit ? parseInt(usage_limit) : null,
            partner_info ? String(partner_info).substring(0, 200) : null
        ],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Code "${cleanCode}" already exists` });
                }
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID, code: cleanCode });
        }
    );
});

router.put('/api/admin/promotions/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ID' });

    const {
        name, code, type, description,
        discount_type, discount_value,
        valid_from, valid_until, min_stay, usage_limit, partner_info
    } = req.body || {};

    if (!name || !code) {
        return res.status(400).json({ success: false, error: 'Code name and promotional code are required' });
    }
    const cleanCode = String(code).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";
    db().run(
        `UPDATE promo_codes
         SET name=?, code=?, type=?, description=?, discount_type=?, discount_value=?,
             valid_from=?, valid_until=?, min_stay=?, usage_limit=?, partner_info=?,
             updated_at=${nowFunc}
         WHERE id=?`,
        [
            String(name).substring(0, 100),
            cleanCode,
            ['seasonal', 'partner', 'general'].includes(type) ? type : 'general',
            description ? String(description).substring(0, 500) : null,
            ['percentage', 'fixed'].includes(discount_type) ? discount_type : 'percentage',
            parseFloat(discount_value) || 0,
            valid_from  || null,
            valid_until || null,
            parseInt(min_stay) || 1,
            usage_limit ? parseInt(usage_limit) : null,
            partner_info ? String(partner_info).substring(0, 200) : null,
            id
        ],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Code "${cleanCode}" already exists` });
                }
                return res.status(500).json({ success: false, error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ success: false, error: 'Promo code not found' });
            res.json({ success: true });
        }
    );
});

router.patch('/api/admin/promotions/:id/status', verifyAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body || {};
    if (!id || !['active', 'paused'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Valid ID and status (active/paused) required' });
    }
    const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";
    db().run(
        `UPDATE promo_codes SET status=?, updated_at=${nowFunc} WHERE id=?`,
        [status, id],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, error: 'Promo code not found' });
            res.json({ success: true });
        }
    );
});

router.delete('/api/admin/promotions/:id', verifyAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ID' });
    db().run('DELETE FROM promo_codes WHERE id=?', [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (this.changes === 0) return res.status(404).json({ success: false, error: 'Promo code not found' });
        res.json({ success: true });
    });
});

// ============================================================
// Content Management
// Stores each page section as a JSON blob in system_settings
// under the key content_{section} (hero, about, accommodations,
// contact, seo).
// ============================================================

router.get('/api/admin/content', verifyAdmin, (req, res) => {
    db().all(
        "SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'content_%'",
        [],
        (err, rows) => {
            if (err) {
                logger.error('Error fetching content settings', { error: err.message });
                return res.status(500).json({ success: false, error: err.message });
            }
            const content = {};
            (rows || []).forEach(row => {
                const section = row.setting_key.replace('content_', '');
                try {
                    content[section] = JSON.parse(row.setting_value);
                } catch (_) {
                    content[section] = {};
                }
            });
            res.json({ success: true, content });
        }
    );
});

router.put('/api/admin/content', verifyAdmin, verifyCsrf, (req, res) => {
    const VALID_SECTIONS = ['hero', 'about', 'accommodations', 'contact', 'seo'];
    const { section, ...fields } = req.body || {};

    if (!section || !VALID_SECTIONS.includes(section)) {
        return res.status(400).json({
            success: false,
            error: 'Valid section required: hero, about, accommodations, contact, seo'
        });
    }

    // Sanitize field values — strings only, max 2000 chars each
    const sanitized = {};
    Object.entries(fields).forEach(([key, value]) => {
        if (typeof value === 'string') {
            sanitized[key] = value.substring(0, 2000);
        }
    });

    const settingKey = `content_${section}`;
    const settingValue = JSON.stringify(sanitized);
    const nowFunc = database.isUsingPostgres() ? 'NOW()' : "datetime('now')";

    ensureSystemSettingsTable((tableErr) => {
        if (tableErr) {
            logger.error('Failed to ensure system_settings table', { error: tableErr.message });
            return res.status(500).json({ success: false, error: 'Database initialization failed' });
        }
        db().run(
            `INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_at)
             VALUES (?, ?, 'json', ${nowFunc})
             ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = excluded.setting_value,
             updated_at = ${nowFunc}`,
            [settingKey, settingValue],
            function(err) {
                if (err) {
                    logger.error('Error saving content', { section, error: err.message });
                    return res.status(500).json({ success: false, error: err.message });
                }
                res.json({ success: true, message: `${section} content saved` });
            }
        );
    });
});

    return router;
}

module.exports = createAdminSettingsRoutes;
