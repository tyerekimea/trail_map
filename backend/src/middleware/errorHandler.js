const logger = require('../utils/logger');
const { captureException } = require('../services/error-tracker');

const errorHandler = (err, req, res, next) => {
  const requestContext = {
    requestId: req?.requestId,
    path: req?.originalUrl,
    method: req?.method,
    ip: req?.ip
  };
  logger.error('Request failed with unhandled error', {
    error: err,
    ...requestContext
  });
  captureException(err, requestContext).catch(() => {});

  // Validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }

  // Duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  if (err.message === 'CORS origin is not allowed') {
    return res.status(403).json({
      success: false,
      message: err.message
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
    requestId: req?.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
