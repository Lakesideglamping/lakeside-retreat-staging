// Reviews API endpoints for Lakeside Retreat
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const router = express.Router();

// Authentication middleware for admin routes
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  } else {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required',
      redirect: '/admin/login'
    });
  }
}

// Initialize SQLite database
const db = new sqlite3.Database('./reviews.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite reviews database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    const schema = fs.readFileSync('./reviews-database.sql', 'utf8');
    db.exec(schema, (err) => {
        if (err) {
            console.error('Error initializing database:', err.message);
        } else {
            console.log('Reviews database initialized successfully');
        }
    });
}


// Email transporter (using existing Titan config)
const createEmailTransporter = () => {
    if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        return nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    }
    return null;
};

// Utility function to send notifications
async function sendNotificationEmail(type, reviewData, adminReply = null) {
    const transporter = createEmailTransporter();
    if (!transporter) return;

    let subject, body;
    
    switch (type) {
        case 'guest_confirmation':
            subject = 'Thank you for your review - Lakeside Retreat';
            body = `
Dear ${reviewData.guest_name},

Thank you for taking the time to share your feedback about your stay at Lakeside Retreat!

Your review has been submitted and is currently under review. We'll notify you once it's been approved and published on our website.

Review Details:
- Accommodation: ${reviewData.accommodation_type}
- Overall Rating: ${reviewData.overall_rating}/5 stars
- Stay Dates: ${reviewData.stay_dates}

We truly appreciate your feedback as it helps us continue to improve our service for future guests.

Warm regards,
Sandy & Stephen
Lakeside Retreat
info@lakesideretreat.co.nz
`;
            break;
            
        case 'admin_new_review':
            subject = `New Guest Review Submitted - ${reviewData.guest_name}`;
            body = `
A new review has been submitted and requires moderation:

Guest: ${reviewData.guest_name} (${reviewData.guest_email})
Location: ${reviewData.guest_location || 'Not provided'}
Accommodation: ${reviewData.accommodation_type}
Stay Dates: ${reviewData.stay_dates}
Overall Rating: ${reviewData.overall_rating}/5 stars

Title: ${reviewData.review_title}
Review: ${reviewData.review_text}

What they loved: ${reviewData.highlight_positive || 'Not provided'}
Suggestions: ${reviewData.suggestions || 'None'}

View and moderate: http://localhost:${process.env.PORT || 10000}/admin/reviews

Please review and approve/reject this submission.
`;
            break;
            
        case 'review_approved':
            subject = 'Your review has been published - Lakeside Retreat';
            body = `
Dear ${reviewData.guest_name},

Great news! Your review has been approved and is now live on our website.

${adminReply ? `We've also responded to your review:\n\n"${adminReply}"\n\n` : ''}

You can view your published review at: http://localhost:${process.env.PORT || 10000}/reviews

Thank you again for sharing your experience with future guests.

Best regards,
Sandy & Stephen
Lakeside Retreat
`;
            break;
    }

    const mailOptions = {
        from: process.env.FROM_EMAIL || 'info@lakesideretreat.co.nz',
        to: type === 'admin_new_review' ? 'info@lakesideretreat.co.nz' : reviewData.guest_email,
        subject: subject,
        text: body
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ ${type} email sent successfully`);
    } catch (error) {
        console.error(`❌ Error sending ${type} email:`, error.message);
    }
}

// PUBLIC ENDPOINTS

// Submit new review
router.post('/submit', async (req, res) => {
    try {
        const {
            guest_name, guest_email, guest_location, accommodation_type,
            stay_dates, overall_rating, cleanliness_rating, location_rating,
            value_rating, communication_rating, review_title, review_text,
            highlight_positive, suggestions, would_recommend, booking_reference
        } = req.body;

        // Validation
        if (!guest_name || !guest_email || !accommodation_type || !overall_rating || !review_text) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }


        const stmt = db.prepare(`
            INSERT INTO reviews (
                guest_name, guest_email, guest_location, accommodation_type, stay_dates,
                overall_rating, cleanliness_rating, location_rating, value_rating, communication_rating,
                review_title, review_text, highlight_positive, suggestions, would_recommend,
                booking_reference, source, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
            guest_name, guest_email, guest_location, accommodation_type, stay_dates,
            overall_rating, cleanliness_rating || null, location_rating || null, 
            value_rating || null, communication_rating || null,
            review_title, review_text, highlight_positive, suggestions, 
            would_recommend === 'true' ? 1 : 0,
            booking_reference, 'website', 'pending'
        ], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to submit review' 
                });
            }

            const reviewData = {
                id: this.lastID,
                guest_name, guest_email, guest_location, accommodation_type,
                stay_dates, overall_rating, review_title, review_text,
                highlight_positive, suggestions
            };

            // Send confirmation emails
            sendNotificationEmail('guest_confirmation', reviewData);
            sendNotificationEmail('admin_new_review', reviewData);

            res.json({
                success: true,
                message: 'Thank you for your review! We\'ll notify you once it\'s published.',
                reviewId: this.lastID
            });
        });

        stmt.finalize();

    } catch (error) {
        console.error('Review submission error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Get approved reviews for public display
router.get('/public', (req, res) => {
    const { accommodation, limit, featured } = req.query;
    
    let sql = `
        SELECT 
            guest_name, guest_location, accommodation_type, stay_dates,
            overall_rating, cleanliness_rating, location_rating, value_rating,
            communication_rating, review_title, review_text, highlight_positive,
            would_recommend, review_photos, admin_reply, approved_at, featured,
            source, verified_stay
        FROM reviews 
        WHERE status = 'approved'
    `;
    
    const params = [];
    
    if (accommodation) {
        sql += ' AND accommodation_type = ?';
        params.push(accommodation);
    }
    
    if (featured === 'true') {
        sql += ' AND featured = 1';
    }
    
    sql += ' ORDER BY featured DESC, approved_at DESC';
    
    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch reviews' 
            });
        }

        // Parse photo URLs
        const reviews = rows.map(row => ({
            ...row,
            review_photos: row.review_photos ? JSON.parse(row.review_photos) : []
        }));

        res.json({
            success: true,
            reviews: reviews
        });
    });
});

// Get review statistics
router.get('/stats', (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) as total_reviews,
            AVG(overall_rating) as average_rating,
            COUNT(CASE WHEN overall_rating = 5 THEN 1 END) as five_star,
            COUNT(CASE WHEN overall_rating = 4 THEN 1 END) as four_star,
            COUNT(CASE WHEN overall_rating = 3 THEN 1 END) as three_star,
            COUNT(CASE WHEN overall_rating = 2 THEN 1 END) as two_star,
            COUNT(CASE WHEN overall_rating = 1 THEN 1 END) as one_star,
            accommodation_type
        FROM reviews 
        WHERE status = 'approved'
        GROUP BY accommodation_type
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch statistics' 
            });
        }

        // Also get overall stats
        const overallSql = `
            SELECT 
                COUNT(*) as total_reviews,
                ROUND(AVG(overall_rating), 1) as average_rating,
                COUNT(CASE WHEN overall_rating = 5 THEN 1 END) as five_star,
                COUNT(CASE WHEN overall_rating = 4 THEN 1 END) as four_star,
                COUNT(CASE WHEN overall_rating = 3 THEN 1 END) as three_star,
                COUNT(CASE WHEN overall_rating = 2 THEN 1 END) as two_star,
                COUNT(CASE WHEN overall_rating = 1 THEN 1 END) as one_star
            FROM reviews 
            WHERE status = 'approved'
        `;

        db.get(overallSql, [], (err, overallStats) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to fetch overall statistics' 
                });
            }

            res.json({
                success: true,
                overall: overallStats,
                by_accommodation: rows
            });
        });
    });
});

// Import external review endpoint
router.post('/import', requireAuth, (req, res) => {
    try {
        const {
            guest_name, guest_email, guest_location, accommodation_type,
            stay_dates, overall_rating, cleanliness_rating, location_rating,
            value_rating, communication_rating, review_title, review_text,
            highlight_positive, suggestions, would_recommend, source,
            status, verified_stay, booking_score
        } = req.body;

        // Validation
        if (!guest_name || !overall_rating || !review_text) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }

        const stmt = db.prepare(`
            INSERT INTO reviews (
                guest_name, guest_email, guest_location, accommodation_type, stay_dates,
                overall_rating, cleanliness_rating, location_rating, value_rating, communication_rating,
                review_title, review_text, highlight_positive, suggestions, would_recommend,
                booking_reference, source, status, verified_stay, approved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Auto-approve imported reviews and set approved_at timestamp
        const approvedAt = status === 'approved' ? new Date().toISOString() : null;

        stmt.run([
            guest_name, 
            guest_email || `${guest_name.toLowerCase().replace(/\s+/g, '.')}@imported.review`,
            guest_location, 
            accommodation_type, 
            stay_dates,
            overall_rating, 
            cleanliness_rating || null, 
            location_rating || null, 
            value_rating || null, 
            communication_rating || null,
            review_title, 
            review_text, 
            highlight_positive, 
            suggestions, 
            would_recommend !== false ? 1 : 0,
            booking_score ? `Booking.com: ${booking_score}/10` : null,
            source || 'external', 
            status || 'approved',
            verified_stay ? 1 : 0,
            approvedAt
        ], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to import review' 
                });
            }

            res.json({
                success: true,
                message: 'Review imported successfully',
                reviewId: this.lastID
            });
        });

        stmt.finalize();

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// ADMIN ENDPOINTS (Protected routes)

// Get all reviews for admin moderation
router.get('/admin/all', requireAuth, (req, res) => {
    const sql = `
        SELECT 
            id, guest_name, guest_email, guest_location, accommodation_type, stay_dates,
            overall_rating, cleanliness_rating, location_rating, value_rating, communication_rating,
            review_title, review_text, highlight_positive, suggestions, would_recommend,
            review_photos, booking_reference, source, status, admin_notes, admin_reply,
            featured, created_at, updated_at, approved_at, verified_stay
        FROM reviews 
        ORDER BY 
            CASE status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 END,
            created_at DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch reviews' 
            });
        }

        res.json({
            success: true,
            reviews: rows
        });
    });
});

// Moderate review (approve/reject)
router.post('/admin/moderate/:id', requireAuth, (req, res) => {
    const reviewId = req.params.id;
    const { status, admin_notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid status' 
        });
    }

    const sql = `
        UPDATE reviews 
        SET status = ?, admin_notes = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;

    const approvedAt = status === 'approved' ? new Date().toISOString() : null;

    db.run(sql, [status, admin_notes, approvedAt, reviewId], function(err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to moderate review' 
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Review not found' 
            });
        }

        // Get review data for notification
        if (status === 'approved') {
            db.get('SELECT * FROM reviews WHERE id = ?', [reviewId], (err, review) => {
                if (!err && review) {
                    sendNotificationEmail('review_approved', review);
                }
            });
        }

        res.json({
            success: true,
            message: `Review ${status} successfully`
        });
    });
});

// Feature/unfeature review
router.post('/admin/feature/:id', requireAuth, (req, res) => {
    const reviewId = req.params.id;
    const { featured } = req.body;

    const sql = `
        UPDATE reviews 
        SET featured = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'approved'
    `;

    db.run(sql, [featured ? 1 : 0, reviewId], function(err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update feature status' 
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Review not found or not approved' 
            });
        }

        res.json({
            success: true,
            message: `Review ${featured ? 'featured' : 'unfeatured'} successfully`
        });
    });
});

// Update admin reply
router.post('/admin/reply/:id', requireAuth, (req, res) => {
    const reviewId = req.params.id;
    const { admin_reply } = req.body;

    const sql = `
        UPDATE reviews 
        SET admin_reply = ?, admin_reply_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'approved'
    `;

    db.run(sql, [admin_reply, reviewId], function(err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update reply' 
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Review not found or not approved' 
            });
        }

        res.json({
            success: true,
            message: 'Reply updated successfully'
        });
    });
});

// Update admin notes
router.post('/admin/notes/:id', requireAuth, (req, res) => {
    const reviewId = req.params.id;
    const { admin_notes } = req.body;

    const sql = `
        UPDATE reviews 
        SET admin_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;

    db.run(sql, [admin_notes, reviewId], function(err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update notes' 
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Review not found' 
            });
        }

        res.json({
            success: true,
            message: 'Notes updated successfully'
        });
    });
});

module.exports = { router, db };