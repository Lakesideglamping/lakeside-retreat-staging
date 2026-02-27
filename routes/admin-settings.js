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
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { verifyAdmin, sendError, ERROR_CODES } = require('../middleware/auth');

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
            console.error('Error fetching seasonal rates:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch seasonal rates' });
        }
        res.json({ success: true, rates: rows || [] });
    });
});

router.post('/api/admin/seasonal-rates', verifyAdmin, (req, res) => {
    const { name, start_date, end_date, multiplier, is_active } = req.body;
    
    if (!name || !start_date || !end_date) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: name, start_date, end_date'
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
            console.error('Error creating seasonal rate:', err);
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

router.put('/api/admin/seasonal-rates/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { name, start_date, end_date, multiplier, is_active } = req.body;
    
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
            console.error('Error updating seasonal rate:', err);
            return res.status(500).json({ success: false, error: 'Failed to update seasonal rate' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Seasonal rate not found' });
        }
        res.json({ success: true, message: 'Seasonal rate updated' });
    });
});

router.delete('/api/admin/seasonal-rates/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db().run('DELETE FROM seasonal_rates WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Error deleting seasonal rate:', err);
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
            console.error('Error reading images directory:', err);
            return res.status(500).json({ success: false, error: 'Failed to read images' });
        }
        
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
        );
        
        const sql = 'SELECT * FROM gallery_images ORDER BY display_order ASC';
        db().all(sql, [], (err, dbImages) => {
            if (err) {
                console.error('Error fetching gallery metadata:', err);
            }
            
            const dbImageMap = new Map((dbImages || []).map(img => [img.filename, img]));
            
            const images = imageFiles.map((filename, index) => {
                const dbData = dbImageMap.get(filename);
                return {
                    id: dbData?.id || null,
                    filename,
                    url: `/images/${filename}`,
                    title: dbData?.title || filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
                    description: dbData?.description || '',
                    property: dbData?.property || 'all',
                    is_hero: dbData?.is_hero || false,
                    is_featured: dbData?.is_featured || false,
                    display_order: dbData?.display_order || index
                };
            });
            
            res.json({
                success: true,
                images,
                total: images.length,
                storage_used: images.length * 0.5
            });
        });
    });
});

router.put('/api/admin/gallery/:filename', verifyAdmin, (req, res) => {
    const { filename } = req.params;
    const { title, description, property, is_hero, is_featured, display_order } = req.body;
    
    const checkSql = 'SELECT id FROM gallery_images WHERE filename = ?';
    db().get(checkSql, [filename], (err, existing) => {
        if (err) {
            console.error('Error checking gallery image:', err);
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
                    console.error('Error updating gallery image:', err);
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
                    console.error('Error inserting gallery image:', err);
                    return res.status(500).json({ success: false, error: 'Failed to save image metadata' });
                }
                res.json({ success: true, message: 'Image metadata saved', id: this.lastID });
            });
        }
    });
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
            console.error('Error fetching reviews:', err);
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

router.post('/api/admin/reviews', verifyAdmin, (req, res) => {
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
            console.error('Error creating review:', err);
            return res.status(500).json({ success: false, error: 'Failed to create review' });
        }
        res.json({ success: true, id: this.lastID, message: 'Review created' });
    });
});

router.put('/api/admin/reviews/:id', verifyAdmin, (req, res) => {
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
            console.error('Error updating review:', err);
            return res.status(500).json({ success: false, error: 'Failed to update review' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Review not found' });
        }
        res.json({ success: true, message: 'Review updated' });
    });
});

router.delete('/api/admin/reviews/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    db().run('DELETE FROM reviews WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('Error deleting review:', err);
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
            console.error('Error fetching pricing:', err);
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
router.post('/api/admin/pricing', verifyAdmin, (req, res) => {
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
            console.error('Failed to ensure system_settings table:', tableErr);
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
                console.error('Error saving pricing:', err);
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
            console.error('Error fetching settings:', err);
            return res.status(500).json({ success: false, error: 'Failed to fetch settings' });
        }
        
        const settings = {};
        (rows || []).forEach(row => {
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

router.put('/api/admin/settings', verifyAdmin, (req, res) => {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'Settings object required' });
    }
    
    const entries = Object.entries(settings);
    let completed = 0;
    let errors = [];
    
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
            console.error('Error reading backups directory:', err);
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

router.post('/api/admin/backups', verifyAdmin, async (req, res) => {
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
        console.error('Error creating backup:', error);
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

router.delete('/api/admin/backups/:filename', verifyAdmin, (req, res) => {
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
            console.error('Error deleting backup:', err);
            return res.status(500).json({ success: false, error: 'Failed to delete backup' });
        }
        res.json({ success: true, message: 'Backup deleted' });
    });
});


    return router;
}

module.exports = createAdminSettingsRoutes;
