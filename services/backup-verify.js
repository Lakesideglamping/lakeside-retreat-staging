/**
 * Backup Verification
 * 
 * Validates backup integrity by:
 * 1. Checking file exists and has non-zero size
 * 2. Computing SHA-256 checksum
 * 3. Opening the SQLite backup and querying table counts
 * 4. Comparing table counts against live database
 * 5. Writing a verification manifest alongside each backup
 * 
 * Usage:
 *   const { verifyBackup, verifyLatestBackup } = require('./services/backup-verify');
 *   const result = await verifyBackup('/path/to/backup.db', liveDb);
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const BACKUP_DIR = './backups';
const TABLES_TO_CHECK = ['bookings', 'contact_messages', 'seasonal_rates', 'gallery_images', 'reviews', 'system_settings'];

/**
 * Compute SHA-256 checksum of a file.
 */
function computeChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Query row counts from a SQLite database file.
 */
function getTableCounts(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(new Error(`Cannot open database: ${err.message}`));
        });

        const counts = {};
        let completed = 0;

        for (const table of TABLES_TO_CHECK) {
            db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                if (err) {
                    counts[table] = { count: -1, error: err.message };
                } else {
                    counts[table] = { count: row.count };
                }

                completed++;
                if (completed === TABLES_TO_CHECK.length) {
                    db.close();
                    resolve(counts);
                }
            });
        }
    });
}

/**
 * Get row counts from the live database connection.
 */
function getLiveCounts(db) {
    return new Promise((resolve, reject) => {
        const counts = {};
        let completed = 0;

        for (const table of TABLES_TO_CHECK) {
            db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                if (err) {
                    counts[table] = { count: -1, error: err.message };
                } else {
                    counts[table] = { count: row ? row.count : 0 };
                }

                completed++;
                if (completed === TABLES_TO_CHECK.length) {
                    resolve(counts);
                }
            });
        }
    });
}

/**
 * Verify a backup file against the live database.
 * 
 * @param {string} backupPath - Path to the backup .db file
 * @param {Object} liveDb - Live SQLite database connection (optional, for comparison)
 * @returns {Object} Verification result
 */
async function verifyBackup(backupPath, liveDb = null) {
    const result = {
        file: path.basename(backupPath),
        path: backupPath,
        timestamp: new Date().toISOString(),
        checks: {},
        passed: true,
        errors: []
    };

    // 1. File existence and size
    try {
        const stats = fs.statSync(backupPath);
        result.checks.fileExists = true;
        result.checks.fileSize = stats.size;
        result.checks.fileSizeKB = Math.round(stats.size / 1024);

        if (stats.size === 0) {
            result.passed = false;
            result.errors.push('Backup file is empty (0 bytes)');
        }
        if (stats.size < 1024) {
            result.passed = false;
            result.errors.push('Backup file suspiciously small (< 1 KB)');
        }
    } catch (err) {
        result.checks.fileExists = false;
        result.passed = false;
        result.errors.push(`File not found: ${err.message}`);
        return result;
    }

    // 2. SHA-256 checksum
    try {
        result.checks.checksum = await computeChecksum(backupPath);
    } catch (err) {
        result.passed = false;
        result.errors.push(`Checksum failed: ${err.message}`);
    }

    // 3. Open backup and query tables
    try {
        const backupCounts = await getTableCounts(backupPath);
        result.checks.backupTables = backupCounts;

        // Check that all tables exist and have data
        for (const table of TABLES_TO_CHECK) {
            if (backupCounts[table]?.error) {
                result.errors.push(`Backup table "${table}" error: ${backupCounts[table].error}`);
                result.passed = false;
            }
        }

        // Bookings table should have at least some data
        if (backupCounts.bookings && backupCounts.bookings.count === 0) {
            result.errors.push('Warning: bookings table is empty in backup');
        }
    } catch (err) {
        result.passed = false;
        result.errors.push(`Cannot read backup database: ${err.message}`);
    }

    // 4. Compare against live database (if provided)
    if (liveDb) {
        try {
            const liveCounts = await getLiveCounts(liveDb);
            result.checks.liveTables = liveCounts;

            // Compare counts — backup should have similar or same counts
            const discrepancies = [];
            for (const table of TABLES_TO_CHECK) {
                const backupCount = result.checks.backupTables?.[table]?.count ?? -1;
                const liveCount = liveCounts[table]?.count ?? -1;

                if (backupCount >= 0 && liveCount >= 0) {
                    const diff = liveCount - backupCount;
                    if (diff > 10) {
                        discrepancies.push(`${table}: backup has ${backupCount} rows vs live ${liveCount} (${diff} missing)`);
                    }
                }
            }

            if (discrepancies.length > 0) {
                result.checks.discrepancies = discrepancies;
                result.errors.push(`Data discrepancies found: ${discrepancies.join('; ')}`);
            }
        } catch (err) {
            result.errors.push(`Live comparison failed: ${err.message}`);
        }
    }

    // 5. Write verification manifest
    try {
        const manifestPath = backupPath.replace(/\.db$/, '.verify.json');
        fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2));
        result.checks.manifestWritten = manifestPath;
    } catch (err) {
        result.errors.push(`Could not write manifest: ${err.message}`);
    }

    return result;
}

/**
 * Find and verify the most recent backup.
 */
async function verifyLatestBackup(liveDb = null) {
    const backupDir = BACKUP_DIR;

    if (!fs.existsSync(backupDir)) {
        return { passed: false, errors: ['Backup directory does not exist'] };
    }

    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('lakeside-backup-') && f.endsWith('.db'))
        .sort()
        .reverse();

    if (files.length === 0) {
        return { passed: false, errors: ['No backup files found'] };
    }

    const latestPath = path.join(backupDir, files[0]);
    console.log(`🔍 Verifying latest backup: ${files[0]}`);

    return verifyBackup(latestPath, liveDb);
}

/**
 * Verify all backups and generate a summary report.
 */
async function verifyAllBackups(liveDb = null) {
    const backupDir = BACKUP_DIR;
    if (!fs.existsSync(backupDir)) {
        return { total: 0, passed: 0, failed: 0, results: [] };
    }

    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('lakeside-backup-') && f.endsWith('.db'))
        .sort();

    const results = [];
    let passed = 0;
    let failed = 0;

    for (const file of files) {
        const result = await verifyBackup(path.join(backupDir, file), liveDb);
        results.push(result);
        if (result.passed) passed++;
        else failed++;
    }

    return { total: files.length, passed, failed, results };
}

module.exports = { verifyBackup, verifyLatestBackup, verifyAllBackups, computeChecksum };
