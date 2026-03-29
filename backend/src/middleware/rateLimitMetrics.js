const rateLimit = require('express-rate-limit');
const logger = require('./logger');

/**
 * Create a rate limiter with metrics logging
 * @param {Object} options - Rate limit options
 * @returns {Function} Express middleware
 */
const createRateLimitWithMetrics = (options = {}) => {
  const {
    windowMs = 900000,
    max = 100,
    message = 'Too many requests',
    keyGenerator = (req) => req.ip,
    skip = () => false,
    handler = null,
    metricsInterval = 300000 // Log metrics every 5 minutes
  } = options;

  // Store for metrics collection
  const attemptCounts = new Map();
  const limitExceededCounts = new Map();
  let totalAttempts = 0;
  let totalLimitExceeded = 0;

  // Create base rate limiter
  const limiter = rateLimit({
    windowMs,
    max,
    message,
    keyGenerator,
    skip,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    handler: handler || ((req, res) => {
      const key = keyGenerator(req);
      limitExceededCounts.set(key, (limitExceededCounts.get(key) || 0) + 1);
      totalLimitExceeded++;

      logger.warn('Rate limit exceeded', {
        ip: key,
        endpoint: req.path,
        method: req.method,
        totalExceededCount: limitExceededCounts.get(key)
      });

      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later'
      });
    })
  });

  // Middleware wrapper to track all attempts
  const middleware = (req, res, next) => {
    const key = keyGenerator(req);
    attemptCounts.set(key, (attemptCounts.get(key) || 0) + 1);
    totalAttempts++;

    return limiter(req, res, next);
  };

  // Periodic metrics logging
  let metricsTimer = null;
  const startMetricsCollection = () => {
    if (metricsTimer) return;

    metricsTimer = setInterval(() => {
      const topOffenders = Array.from(limitExceededCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ip, count]) => ({ ip, limitExceededCount: count }));

      logger.info('Rate limit metrics', {
        windowMs,
        maxPerWindow: max,
        totalAttempts,
        totalLimitExceeded,
        activeIPs: attemptCounts.size,
        limitExceededIPs: limitExceededCounts.size,
        topOffenders
      });

      // Reset counters for next interval
      totalAttempts = 0;
      totalLimitExceeded = 0;
      attemptCounts.clear();
      limitExceededCounts.clear();
    }, metricsInterval);
  };

  const stopMetricsCollection = () => {
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
    }
  };

  middleware.startMetrics = startMetricsCollection;
  middleware.stopMetrics = stopMetricsCollection;

  return middleware;
};

module.exports = {
  createRateLimitWithMetrics
};
