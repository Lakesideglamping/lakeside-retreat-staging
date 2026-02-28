/**
 * Admin Operations Routes
 * 
 * Monitoring, analytics, notifications, chatbot admin, and marketing:
 * - GET  /api/admin/metrics — performance metrics
 * - GET  /api/admin/monitoring-report — monitoring report
 * - GET  /api/admin/cache-stats — cache and queue stats
 * - POST /api/admin/cache/clear — clear all caches
 * - GET  /api/admin/health-detailed — detailed health check
 * - GET  /api/admin/notifications — notification summary
 * - GET  /api/admin/analytics — analytics dashboard data
 * - POST /api/admin/chatbot/email-reply — generate email reply draft
 * - GET  /api/admin/chatbot/status — chatbot status
 * - Marketing endpoints (stats, abandoned carts, reviews, social content)
 */

const express = require('express');
const router = express.Router();

const { verifyAdmin, verifyCsrf, sendError, ERROR_CODES } = require('../middleware/auth');

/**
 * @param {Object} deps
 * @param {Function} deps.db - Returns database connection
 * @param {Function} deps.getMetrics - Get monitoring metrics
 * @param {Function} deps.generateReport - Generate monitoring report
 * @param {Function} deps.log - Structured logging
 * @param {Object} deps.CacheManager - Cache manager
 * @param {Object} deps.bookingQueue - Booking queue
 * @param {Object} deps.generalQueue - General queue
 * @param {Object} deps.paymentQueue - Payment queue
 * @param {Object} deps.chatbot - ChatbotService instance
 * @param {Function} deps.getMarketingAutomation - Returns marketing automation instance
 */
function createAdminOperationsRoutes(deps) {
    const { db, getMetrics, generateReport, log, CacheManager,
             bookingQueue, generalQueue, paymentQueue,
             chatbot, getMarketingAutomation, database } = deps;

// Get system metrics (admin only)
router.get('/api/admin/metrics', verifyAdmin, (req, res) => {
    try {
        const metrics = getMetrics();
        res.json({
            success: true,
            metrics: metrics
        });
    } catch (error) {
        log('ERROR', 'Failed to retrieve metrics', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to retrieve metrics');
    }
});

// Generate monitoring report (admin only)
router.get('/api/admin/monitoring-report', verifyAdmin, (req, res) => {
    try {
        const report = generateReport();
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        log('ERROR', 'Failed to generate monitoring report', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to generate report');
    }
});

// Cache statistics (admin only)
router.get('/api/admin/cache-stats', verifyAdmin, (req, res) => {
    try {
        const cacheStats = CacheManager.getAllStats();
        const queueStats = {
            booking: bookingQueue.getStats(),
            general: generalQueue.getStats(),
            payment: paymentQueue.getStats()
        };
        
        res.json({
            success: true,
            cache: cacheStats,
            queues: queueStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log('ERROR', 'Failed to retrieve cache stats', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to retrieve cache statistics');
    }
});

// Clear cache (admin only)
router.post('/api/admin/cache/clear', verifyAdmin, verifyCsrf, (req, res) => {
    try {
        const cleared = CacheManager.clearAll();
        
        log('INFO', 'Cache cleared by admin', { cleared });
        
        res.json({
            success: true,
            message: 'Cache cleared successfully',
            cleared: cleared
        });
    } catch (error) {
        log('ERROR', 'Failed to clear cache', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Failed to clear cache');
    }
});

// Health check with detailed metrics (admin only)
router.get('/api/admin/health-detailed', verifyAdmin, (req, res) => {
    try {
        const metrics = getMetrics();
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: uptime,
                human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
            },
            memory: {
                used: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
                total: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
                external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`
            },
            performance: {
                totalBookings: metrics.bookings.total,
                conversionRate: `${metrics.bookings.conversionRate}%`,
                averageResponseTime: `${metrics.performance.responseTime.average.toFixed(2)}ms`,
                apiSuccessRate: `${((metrics.performance.apiCalls.successful / metrics.performance.apiCalls.total) * 100).toFixed(2)}%`
            },
            errors: {
                total: metrics.errors.total,
                recent: metrics.errors.byCode
            }
        };
        
        res.json({
            success: true,
            health: health
        });
    } catch (error) {
        log('ERROR', 'Failed to generate detailed health check', { error: error.message });
        return sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR, 'Health check failed');
    }
});

// Notifications summary endpoint for admin dashboard
router.get('/api/admin/notifications', verifyAdmin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    // Calculate yesterday's date for "last 24 hours" query (works in both SQLite and PostgreSQL)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const queries = {
        // Critical: Failed payments
        failedPayments: `SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'failed'`,
        // Critical: Sync failures (paid but not synced to Uplisting)
        syncFailures: `SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'completed' AND uplisting_id IS NULL`,
        // Warning: Abandoned checkouts (from marketing automation table)
        abandonedCheckouts: `SELECT COUNT(*) as count FROM abandoned_checkout_reminders WHERE reminder_count < 2`,
        // Pending: Pending bookings awaiting payment
        pendingBookings: `SELECT COUNT(*) as count FROM bookings WHERE status = 'pending' AND payment_status = 'pending'`,
        // Pending: Today's check-ins
        todayCheckins: `SELECT COUNT(*) as count FROM bookings WHERE check_in = ? AND status = 'confirmed'`,
        // Pending: Today's check-outs
        todayCheckouts: `SELECT COUNT(*) as count FROM bookings WHERE check_out = ? AND status = 'confirmed'`,
        // Resolved: Recent confirmed bookings (last 24 hours)
        recentConfirmed: `SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed' AND payment_status = 'completed' AND created_at >= ?`
    };
    
    const results = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;
    
    const runQuery = (key, sql, params = []) => {
        db().get(sql, params, (err, row) => {
            if (err) {
                results[key] = 0;
            } else {
                results[key] = row ? row.count : 0;
            }
            completed++;
            
            if (completed === totalQueries) {
                // Calculate totals
                const critical = results.failedPayments + results.syncFailures;
                const warnings = results.abandonedCheckouts;
                const pending = results.pendingBookings + results.todayCheckins + results.todayCheckouts;
                const resolved = results.recentConfirmed;
                
                res.json({
                    success: true,
                    summary: {
                        critical,
                        warnings,
                        pending,
                        resolved
                    },
                    details: results
                });
            }
        });
    };
    
    runQuery('failedPayments', queries.failedPayments);
    runQuery('syncFailures', queries.syncFailures);
    runQuery('abandonedCheckouts', queries.abandonedCheckouts);
    runQuery('pendingBookings', queries.pendingBookings);
    runQuery('todayCheckins', queries.todayCheckins, [today]);
    runQuery('todayCheckouts', queries.todayCheckouts, [today]);
    runQuery('recentConfirmed', queries.recentConfirmed, [yesterday]);
});

// Analytics endpoint for admin dashboard
router.get('/api/admin/analytics', verifyAdmin, (req, res) => {
    const dateRange = req.query.dateRange || 'month';
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (dateRange) {
        case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case 'quarter':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        case 'year':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    // Use parameterized query with ISO string (works in both SQLite and PostgreSQL)
    const startDateISO = startDate.toISOString();
    const dateCondition = 'WHERE created_at >= ?';
    
    // Use database-specific date formatting for grouping
    const isPostgres = database.isUsingPostgres();
    const monthFormat = isPostgres 
        ? "TO_CHAR(created_at, 'YYYY-MM')" 
        : "strftime('%Y-%m', created_at)";
    
    const analytics = {};
    
    // Get booking analytics
    db().get(
        `SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as paid_bookings,
            SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue,
            AVG(CASE WHEN payment_status = 'completed' THEN total_price END) as avg_booking_value,
            COUNT(DISTINCT accommodation) as accommodations_booked
        FROM bookings ${dateCondition}`,
        [startDateISO],
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            analytics.summary = row;
            
            // Get booking trends by month
            db().all(
                `SELECT 
                    ${monthFormat} as month,
                    COUNT(*) as bookings,
                    SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue
                FROM bookings ${dateCondition}
                GROUP BY ${monthFormat}
                ORDER BY month DESC`,
                [startDateISO],
                (err, trends) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    analytics.trends = trends;
                    
                    // Get accommodation performance
                    db().all(
                        `SELECT 
                            accommodation,
                            COUNT(*) as bookings,
                            SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as revenue,
                            AVG(CASE WHEN payment_status = 'completed' THEN total_price END) as avg_price
                        FROM bookings ${dateCondition}
                        GROUP BY accommodation
                        ORDER BY revenue DESC`,
                        [startDateISO],
                        (err, accommodations) => {
                            if (err) {
                                return res.status(500).json({ success: false, error: err.message });
                            }
                            
                            analytics.accommodations = accommodations;
                            
                            res.json({
                                success: true,
                                dateRange: dateRange,
                                analytics: analytics
                            });
                        }
                    );
                }
            );
        }
    );
});

// Admin endpoint - generate email reply drafts
router.post('/api/admin/chatbot/email-reply', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const { emailContent, guestName, bookingId } = req.body;
        
        if (!emailContent || typeof emailContent !== 'string') {
            return res.status(400).json({ 
                success: false, 
                error: 'Email content is required' 
            });
        }
        
        const result = await chatbot.generateEmailReply(emailContent, {
            guestName: guestName,
            bookingId: bookingId
        });
        
        res.json({
            success: result.success,
            suggestedReply: result.suggestedReply,
            source: result.source
        });
        
    } catch (error) {
        console.error('Email reply generation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate email reply' 
        });
    }
});

// Admin endpoint - get chatbot status
router.get('/api/admin/chatbot/status', verifyAdmin, (req, res) => {
    res.json({
        success: true,
        aiEnabled: chatbot.aiEnabled,
        knowledgeBaseLoaded: !!chatbot.knowledgeBase,
        activeSessions: chatbot.conversationHistory.size
    });
});

// Admin endpoint - Get marketing stats
router.get('/api/admin/marketing/stats', verifyAdmin, async (req, res) => {
    try {
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const stats = await marketingAutomation.getMarketingStats();
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error getting marketing stats:', error);
        res.status(500).json({ success: false, error: 'Failed to get marketing stats' });
    }
});

// Admin endpoint - Get abandoned checkouts
router.get('/api/admin/marketing/abandoned-checkouts', verifyAdmin, async (req, res) => {
    try {
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const abandonedCheckouts = await marketingAutomation.getAbandonedCheckouts();
        res.json({ success: true, abandonedCheckouts });
    } catch (error) {
        console.error('Error getting abandoned checkouts:', error);
        res.status(500).json({ success: false, error: 'Failed to get abandoned checkouts' });
    }
});

// Admin endpoint - Send abandoned checkout reminder
router.post('/api/admin/marketing/send-reminder/:bookingId', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const result = await marketingAutomation.sendManualReminder(bookingId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error sending reminder:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to send reminder' });
    }
});

// Admin endpoint - Run abandoned checkout check manually
router.post('/api/admin/marketing/run-abandoned-check', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.processAbandonedCheckouts();
        res.json({ success: true, message: 'Abandoned checkout check completed' });
    } catch (error) {
        console.error('Error running abandoned check:', error);
        res.status(500).json({ success: false, error: 'Failed to run abandoned check' });
    }
});

// Admin endpoint - Get review requests
router.get('/api/admin/marketing/review-requests', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const reviewRequests = await marketingAutomation.getReviewRequests(status);
        res.json({ success: true, reviewRequests });
    } catch (error) {
        console.error('Error getting review requests:', error);
        res.status(500).json({ success: false, error: 'Failed to get review requests' });
    }
});

// Admin endpoint - Send review request manually
router.post('/api/admin/marketing/send-review-request/:bookingId', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const result = await marketingAutomation.sendManualReviewRequest(bookingId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error sending review request:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to send review request' });
    }
});

// Admin endpoint - Run review request check manually
router.post('/api/admin/marketing/run-review-check', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.processReviewRequests();
        res.json({ success: true, message: 'Review request check completed' });
    } catch (error) {
        console.error('Error running review check:', error);
        res.status(500).json({ success: false, error: 'Failed to run review check' });
    }
});

// Admin endpoint - Generate social content
router.post('/api/admin/marketing/generate-social', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const { platform, tone, sourceText, accommodation, saveDraft } = req.body;
        
        if (!platform || !tone) {
            return res.status(400).json({ 
                success: false, 
                error: 'platform and tone are required' 
            });
        }
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const content = await marketingAutomation.generateSocialContent({
            platform,
            tone,
            sourceText,
            accommodation,
            saveDraft: saveDraft || false
        });
        res.json({ success: true, content });
    } catch (error) {
        console.error('Error generating social content:', error);
        res.status(500).json({ success: false, error: 'Failed to generate social content' });
    }
});

// Admin endpoint - Get social content drafts
router.get('/api/admin/marketing/social-drafts', verifyAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        const drafts = await marketingAutomation.getSocialDrafts(status || 'draft');
        res.json({ success: true, drafts });
    } catch (error) {
        console.error('Error getting social drafts:', error);
        res.status(500).json({ success: false, error: 'Failed to get social drafts' });
    }
});

// Admin endpoint - Update social draft status
router.put('/api/admin/marketing/social-drafts/:draftId', verifyAdmin, verifyCsrf, async (req, res) => {
    try {
        const { draftId } = req.params;
        const { status } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                success: false, 
                error: 'status is required' 
            });
        }
        
        const marketingAutomation = getMarketingAutomation();
        if (!marketingAutomation) {
            return res.status(503).json({ 
                success: false, 
                error: 'Marketing automation not initialized' 
            });
        }
        
        await marketingAutomation.updateDraftStatus(draftId, status);
        res.json({ success: true, message: 'Draft status updated' });
    } catch (error) {
        console.error('Error updating draft status:', error);
        res.status(500).json({ success: false, error: 'Failed to update draft status' });
    }
});


    return router;
}

module.exports = createAdminOperationsRoutes;
