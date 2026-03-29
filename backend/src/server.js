const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { initFirestore, db } = require('./config/firestore');
const { validateRuntimeEnv, parseAllowedOrigins } = require('./config/env');
const logger = require('./utils/logger');
const { captureException } = require('./services/error-tracker');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const placesRoutes = require('./routes/places');
const mapsRoutes = require('./routes/maps');
const businessRoutes = require('./routes/businesses');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const { protect } = require('./middleware/auth');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { setupSwagger } = require('./config/swagger');

validateRuntimeEnv();

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const trustProxy = parseInt(process.env.TRUST_PROXY || '1', 10);
if (Number.isFinite(trustProxy) && trustProxy >= 0) {
  app.set('trust proxy', trustProxy);
}

const isNonMapApiRoute = (path) =>
  path.startsWith('/api/') &&
  !path.startsWith('/api/maps');

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS origin is not allowed'));
    },
    credentials: true
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts. Please try again later.'
});
app.use('/api/auth', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

// Basic payload validation for non-map API write routes
app.use((req, res, next) => {
  if (!isNonMapApiRoute(req.path)) {
    return next();
  }

  const writeMethods = ['POST', 'PUT', 'PATCH'];
  if (!writeMethods.includes(req.method)) {
    return next();
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({
      success: false,
      message: 'Content-Type must be application/json'
    });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Request body must be a JSON object'
    });
  }

  next();
});

// Compression
app.use(compression());

// Logging
app.use(
  morgan(
    (tokens, req, res) =>
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'http_request',
        method: tokens.method(req, res),
        path: tokens.url(req, res),
        status: Number(tokens.status(req, res) || 0),
        responseTimeMs: Number(tokens['response-time'](req, res) || 0),
        contentLength: Number(tokens.res(req, res, 'content-length') || 0),
        requestId: req.requestId,
        ip: req.ip
      }),
    {
      skip: (req) => req.path === '/health'
    }
  )
);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

app.get('/health/deep', async (req, res) => {
  try {
    await db.collection('users').limit(1).get();
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {
        firestore: 'ok'
      }
    });
  } catch (error) {
    return res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        firestore: 'error'
      },
      message: 'Dependent service unavailable'
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/maps', protect, mapsRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);

const enableSwaggerDocs =
  process.env.ENABLE_SWAGGER_DOCS === 'true' ||
  process.env.NODE_ENV !== 'production';
if (enableSwaggerDocs) {
  setupSwagger(app);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use(errorHandler);

try {
  initFirestore();
  logger.info('Connected to Firestore');
} catch (error) {
  logger.error('Firestore initialization error', { error });
  process.exit(1);
}

// Start server
const server = app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV,
    docsEnabled: enableSwaggerDocs,
    docsUrl: enableSwaggerDocs ? `${process.env.API_URL || `http://localhost:${PORT}`}/api/docs` : null,
    healthUrl: `${process.env.API_URL || `http://localhost:${PORT}`}/health`
  });
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    logger.error('Port already in use', { port: PORT });
  } else {
    logger.error('Server failed to start', { error });
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received, closing HTTP server');
  server.close(() => process.exit(0));
});

process.on('unhandledRejection', (reason) => {
  captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    source: 'process.unhandledRejection'
  }).finally(() => process.exit(1));
});

process.on('uncaughtException', (error) => {
  captureException(error, {
    source: 'process.uncaughtException'
  }).finally(() => process.exit(1));
});

module.exports = app;
