/**
 * Monitoring and Logging System for Lakeside Retreat
 * Provides comprehensive tracking of booking flows, performance metrics, and system health
 */

const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4
};

// Monitoring metrics storage
const metrics = {
    bookings: {
        total: 0,
        successful: 0,
        failed: 0,
        abandoned: 0,
        conversionRate: 0
    },
    performance: {
        responseTime: {
            total: 0,
            count: 0,
            average: 0,
            p95: 0,
            p99: 0
        },
        apiCalls: {
            total: 0,
            successful: 0,
            failed: 0
        }
    },
    errors: {
        byCode: {},
        byEndpoint: {},
        total: 0
    },
    system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version
    }
};

// Response time tracking for percentiles
const responseTimes = [];
const MAX_RESPONSE_TIMES = 1000; // Keep last 1000 response times

class MonitoringSystem {
    constructor(options = {}) {
        this.logLevel = LOG_LEVELS[options.logLevel] || LOG_LEVELS.INFO;
        this.logFile = options.logFile || path.join(__dirname, 'logs', 'booking-system.log');
        this.metricsFile = options.metricsFile || path.join(__dirname, 'logs', 'metrics.json');
        this.ensureLogDirectory();
        
        // Start periodic metric updates
        this.startMetricUpdates();
    }
    
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    
    // Centralized logging function
    log(level, message, meta = {}) {
        if (LOG_LEVELS[level] < this.logLevel) return;
        
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...meta,
            ...(meta.requestId && { requestId: meta.requestId }),
            ...(meta.userId && { userId: meta.userId }),
            ...(meta.sessionId && { sessionId: meta.sessionId })
        };
        
        // Console output
        const color = this.getLogColor(level);
        console.log(`${color}[${timestamp}] ${level}: ${message}${meta.requestId ? ` (${meta.requestId})` : ''}\x1b[0m`);
        
        // File output
        fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n', (err) => {
            if (err) console.error('Failed to write log:', err.message);
        });
        
        // Update error metrics
        if (level === 'ERROR' || level === 'CRITICAL') {
            this.trackError(meta.errorCode, meta.endpoint);
        }
    }
    
    getLogColor(level) {
        const colors = {
            DEBUG: '\x1b[36m',    // Cyan
            INFO: '\x1b[32m',     // Green
            WARN: '\x1b[33m',     // Yellow
            ERROR: '\x1b[31m',    // Red
            CRITICAL: '\x1b[35m'  // Magenta
        };
        return colors[level] || '\x1b[0m';
    }
    
    // Booking flow tracking
    trackBookingStart(bookingData, requestId) {
        metrics.bookings.total++;
        this.log('INFO', 'Booking flow started', {
            requestId,
            accommodation: bookingData.accommodation,
            guests: bookingData.guests,
            checkIn: bookingData.checkin,
            checkOut: bookingData.checkout,
            flow: 'booking_start'
        });
    }
    
    trackBookingStep(step, requestId, meta = {}) {
        this.log('INFO', `Booking step: ${step}`, {
            requestId,
            step,
            flow: 'booking_step',
            ...meta
        });
    }
    
    trackBookingSuccess(bookingId, requestId, totalAmount) {
        metrics.bookings.successful++;
        this.updateConversionRate();
        
        this.log('INFO', 'Booking completed successfully', {
            requestId,
            bookingId,
            totalAmount,
            flow: 'booking_success'
        });
    }
    
    trackBookingFailure(error, requestId, step = null) {
        metrics.bookings.failed++;
        this.updateConversionRate();
        
        this.log('ERROR', 'Booking failed', {
            requestId,
            error: error.message,
            errorCode: error.code,
            step,
            flow: 'booking_failure'
        });
    }
    
    trackBookingAbandonment(requestId, lastStep) {
        metrics.bookings.abandoned++;
        this.updateConversionRate();
        
        this.log('WARN', 'Booking abandoned', {
            requestId,
            lastStep,
            flow: 'booking_abandoned'
        });
    }
    
    // Performance tracking
    trackApiCall(method, endpoint, responseTime, success, requestId) {
        metrics.performance.apiCalls.total++;
        
        if (success) {
            metrics.performance.apiCalls.successful++;
        } else {
            metrics.performance.apiCalls.failed++;
        }
        
        // Track response time
        this.trackResponseTime(responseTime);
        
        this.log(success ? 'INFO' : 'WARN', `API call: ${method} ${endpoint}`, {
            requestId,
            method,
            endpoint,
            responseTime: `${responseTime}ms`,
            success,
            performance: 'api_call'
        });
    }
    
    trackResponseTime(responseTime) {
        metrics.performance.responseTime.total += responseTime;
        metrics.performance.responseTime.count++;
        metrics.performance.responseTime.average = 
            metrics.performance.responseTime.total / metrics.performance.responseTime.count;
        
        // Add to response times array for percentile calculation
        responseTimes.push(responseTime);
        if (responseTimes.length > MAX_RESPONSE_TIMES) {
            responseTimes.shift(); // Remove oldest
        }
        
        // Update percentiles
        this.updatePercentiles();
    }
    
    updatePercentiles() {
        if (responseTimes.length === 0) return;
        
        const sorted = [...responseTimes].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);
        
        metrics.performance.responseTime.p95 = sorted[p95Index] || 0;
        metrics.performance.responseTime.p99 = sorted[p99Index] || 0;
    }
    
    // Error tracking
    trackError(errorCode, endpoint) {
        metrics.errors.total++;
        
        if (errorCode) {
            metrics.errors.byCode[errorCode] = (metrics.errors.byCode[errorCode] || 0) + 1;
        }
        
        if (endpoint) {
            metrics.errors.byEndpoint[endpoint] = (metrics.errors.byEndpoint[endpoint] || 0) + 1;
        }
    }
    
    // System health monitoring
    trackSystemHealth() {
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        metrics.system = {
            uptime,
            memoryUsage: memUsage,
            nodeVersion: process.version,
            timestamp: new Date().toISOString()
        };
        
        // Log memory warnings
        const memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
        if (memoryUsageMB > 500) { // Warning at 500MB
            this.log('WARN', `High memory usage: ${memoryUsageMB.toFixed(2)}MB`, {
                memoryUsage: memUsage,
                system: 'memory_warning'
            });
        }
        
        this.log('DEBUG', 'System health check', {
            uptime: `${Math.floor(uptime / 60)}min`,
            memory: `${memoryUsageMB.toFixed(2)}MB`,
            system: 'health_check'
        });
    }
    
    // Utility functions
    updateConversionRate() {
        if (metrics.bookings.total > 0) {
            metrics.bookings.conversionRate = 
                (metrics.bookings.successful / metrics.bookings.total * 100).toFixed(2);
        }
    }
    
    startMetricUpdates() {
        // Update system health every 5 minutes
        const healthTimer = setInterval(() => {
            this.trackSystemHealth();
            this.saveMetrics();
        }, 5 * 60 * 1000);
        if (healthTimer.unref) healthTimer.unref();

        // Save metrics every minute
        const metricsTimer = setInterval(() => {
            this.saveMetrics();
        }, 60 * 1000);
        if (metricsTimer.unref) metricsTimer.unref();
    }
    
    saveMetrics() {
        fs.writeFile(this.metricsFile, JSON.stringify(metrics, null, 2), (err) => {
            if (err) console.error('Failed to save metrics:', err.message);
        });
    }
    
    // Generate monitoring report
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalBookings: metrics.bookings.total,
                successfulBookings: metrics.bookings.successful,
                failedBookings: metrics.bookings.failed,
                conversionRate: `${metrics.bookings.conversionRate}%`,
                averageResponseTime: `${metrics.performance.responseTime.average.toFixed(2)}ms`,
                uptime: `${Math.floor(metrics.system.uptime / 3600)}h ${Math.floor((metrics.system.uptime % 3600) / 60)}m`
            },
            performance: {
                responseTime: {
                    average: `${metrics.performance.responseTime.average.toFixed(2)}ms`,
                    p95: `${metrics.performance.responseTime.p95}ms`,
                    p99: `${metrics.performance.responseTime.p99}ms`
                },
                apiCalls: {
                    total: metrics.performance.apiCalls.total,
                    successRate: `${((metrics.performance.apiCalls.successful / metrics.performance.apiCalls.total) * 100).toFixed(2)}%`
                }
            },
            errors: {
                total: metrics.errors.total,
                byCode: metrics.errors.byCode,
                topEndpoints: Object.entries(metrics.errors.byEndpoint)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5)
                    .map(([endpoint, count]) => ({ endpoint, count }))
            },
            system: metrics.system
        };
        
        return report;
    }
    
    // Express middleware for request tracking
    middleware() {
        return (req, res, next) => {
            const startTime = Date.now();
            const requestId = req.headers['x-request-id'] || this.generateRequestId();
            
            req.requestId = requestId;
            req.startTime = startTime;
            
            // Override res.json to track response
            const originalJson = res.json;
            res.json = function(data) {
                const responseTime = Date.now() - startTime;
                const success = res.statusCode < 400;
                
                // Track API call
                monitor.trackApiCall(req.method, req.path, responseTime, success, requestId);
                
                return originalJson.call(this, data);
            };
            
            next();
        };
    }
    
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Create global monitoring instance
const monitor = new MonitoringSystem({
    logLevel: process.env.LOG_LEVEL || 'INFO'
});

// Export monitoring functions for use in server.js
module.exports = {
    monitor,
    trackBookingStart: (data, requestId) => monitor.trackBookingStart(data, requestId),
    trackBookingStep: (step, requestId, meta) => monitor.trackBookingStep(step, requestId, meta),
    trackBookingSuccess: (bookingId, requestId, amount) => monitor.trackBookingSuccess(bookingId, requestId, amount),
    trackBookingFailure: (error, requestId, step) => monitor.trackBookingFailure(error, requestId, step),
    trackBookingAbandonment: (requestId, lastStep) => monitor.trackBookingAbandonment(requestId, lastStep),
    log: (level, message, meta) => monitor.log(level, message, meta),
    middleware: () => monitor.middleware(),
    generateReport: () => monitor.generateReport(),
    getMetrics: () => metrics
};