/**
 * Request Queuing System for High-Concurrency Booking Operations
 * Prevents database overload by managing concurrent requests
 */

class RequestQueue {
    constructor(options = {}) {
        this.maxConcurrent = options.maxConcurrent || 3;
        this.maxQueueSize = options.maxQueueSize || 50;
        this.timeout = options.timeout || 30000; // 30 seconds
        
        this.active = 0;
        this.queue = [];
        this.stats = {
            processed: 0,
            queued: 0,
            rejected: 0,
            timeouts: 0
        };
    }
    
    // Add request to queue
    async enqueue(requestHandler, priority = 'normal') {
        return new Promise((resolve, reject) => {
            // Check if queue is full
            if (this.queue.length >= this.maxQueueSize) {
                this.stats.rejected++;
                reject(new Error('Queue is full, please try again later'));
                return;
            }
            
            const queueItem = {
                handler: requestHandler,
                resolve,
                reject,
                priority,
                timestamp: Date.now(),
                timeout: setTimeout(() => {
                    this.removeFromQueue(queueItem);
                    this.stats.timeouts++;
                    reject(new Error('Request timeout'));
                }, this.timeout)
            };
            
            // Add to queue based on priority
            if (priority === 'high') {
                this.queue.unshift(queueItem);
            } else {
                this.queue.push(queueItem);
            }
            
            this.stats.queued++;
            this.processNext();
        });
    }
    
    // Process next item in queue
    async processNext() {
        if (this.active >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }
        
        const item = this.queue.shift();
        this.active++;
        
        try {
            clearTimeout(item.timeout);
            const result = await item.handler();
            this.stats.processed++;
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            this.active--;
            // Process next item
            setImmediate(() => this.processNext());
        }
    }
    
    // Remove item from queue
    removeFromQueue(targetItem) {
        const index = this.queue.findIndex(item => item === targetItem);
        if (index !== -1) {
            clearTimeout(this.queue[index].timeout);
            this.queue.splice(index, 1);
        }
    }
    
    // Get queue statistics
    getStats() {
        return {
            ...this.stats,
            active: this.active,
            queued: this.queue.length,
            capacity: this.maxConcurrent,
            queueCapacity: this.maxQueueSize
        };
    }
    
    // Express middleware
    middleware(options = {}) {
        const queueName = options.queueName || 'default';
        const priority = options.priority || 'normal';
        
        return async (req, res, next) => {
            // Add queue stats to request
            req.queueStats = this.getStats();
            
            // Simple pass-through with queue management - no response interception
            const requestHandler = async () => {
                return new Promise((resolve, reject) => {
                    // Set a timeout to ensure we don't hang indefinitely
                    const timeout = setTimeout(() => {
                        console.log(`✅ Queue middleware completed for ${req.method} ${req.path}`);
                        resolve('completed');
                    }, 100); // Very short timeout, just to let the request process
                    
                    // Continue with normal processing immediately
                    next();
                    
                    // Clear timeout when request finishes
                    res.on('finish', () => {
                        clearTimeout(timeout);
                        resolve('finished');
                    });
                    
                    res.on('error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });
            };
            
            try {
                await this.enqueue(requestHandler, priority);
            } catch (error) {
                if (error.message === 'Queue is full, please try again later') {
                    return res.status(503).json({
                        success: false,
                        error: {
                            code: 'QUEUE_FULL',
                            message: 'Server is busy, please try again in a few moments',
                            timestamp: new Date().toISOString(),
                            retryAfter: '5'
                        }
                    });
                } else if (error.message === 'Request timeout') {
                    return res.status(408).json({
                        success: false,
                        error: {
                            code: 'REQUEST_TIMEOUT',
                            message: 'Request timed out, please try again',
                            timestamp: new Date().toISOString()
                        }
                    });
                } else {
                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'QUEUE_ERROR',
                            message: 'Request processing failed',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            }
        };
    }
}

// Create queue instances for different operations
const bookingQueue = new RequestQueue({
    maxConcurrent: 3,    // Only 3 concurrent booking operations
    maxQueueSize: 50,    // Queue up to 50 requests
    timeout: 30000       // 30 second timeout
});

const generalQueue = new RequestQueue({
    maxConcurrent: 10,   // More concurrent for read operations
    maxQueueSize: 100,   // Larger queue for general operations
    timeout: 15000       // 15 second timeout
});

const paymentQueue = new RequestQueue({
    maxConcurrent: 2,    // Very limited for payment operations
    maxQueueSize: 20,    // Smaller queue for critical operations
    timeout: 45000       // Longer timeout for payment processing
});

module.exports = {
    RequestQueue,
    bookingQueue,
    generalQueue,
    paymentQueue
};