const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { initFirestore } = require('./config/firestore');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const placesRoutes = require('./routes/places');
const mapsRoutes = require('./routes/maps');
const subscriptionRoutes = require('./routes/subscriptions');
const businessRoutes = require('./routes/businesses');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { setupSwagger } = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isNonMapApiRoute = (path) =>
  path.startsWith('/api/') &&
  !path.startsWith('/api/maps') &&
  path !== '/api/subscriptions/webhook';

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
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Webhooks need the raw request body for signature verification
app.use(
  '/api/subscriptions/webhook',
  express.raw({ type: 'application/json', limit: '2mb' })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);

// Swagger documentation
setupSwagger(app);

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
  console.log('✅ Connected to Firestore');
} catch (error) {
  console.error('❌ Firestore initialization error:', error);
  process.exit(1);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

module.exports = app;
