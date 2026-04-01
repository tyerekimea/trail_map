const express = require('express');
const axios = require('axios');
const { query, validationResult } = require('express-validator');

const router = express.Router();
const GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api';
const circuitBreakerState = {
  consecutiveFailures: 0,
  openedAt: null
};

const resolveCircuitBreakerConfig = () => ({
  failureThreshold: parseInt(process.env.MAPS_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 10) || 5,
  cooldownMs: parseInt(process.env.MAPS_CIRCUIT_BREAKER_COOLDOWN_MS, 10) || 60 * 1000
});

const isCircuitOpen = () => {
  if (!circuitBreakerState.openedAt) {
    return false;
  }

  const { cooldownMs } = resolveCircuitBreakerConfig();
  const elapsed = Date.now() - circuitBreakerState.openedAt;
  if (elapsed >= cooldownMs) {
    circuitBreakerState.openedAt = null;
    circuitBreakerState.consecutiveFailures = 0;
    return false;
  }
  return true;
};

const markUpstreamSuccess = () => {
  circuitBreakerState.consecutiveFailures = 0;
  circuitBreakerState.openedAt = null;
};

const markUpstreamFailure = () => {
  const { failureThreshold } = resolveCircuitBreakerConfig();
  circuitBreakerState.consecutiveFailures += 1;
  if (circuitBreakerState.consecutiveFailures >= failureThreshold) {
    circuitBreakerState.openedAt = Date.now();
  }
};

const requireMapsApiKey = (req, res, next) => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({
      status: 'REQUEST_DENIED',
      error_message: 'Maps proxy is not configured on the server.'
    });
  }
  next();
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'INVALID_REQUEST',
      error_message: errors.array().map((e) => e.msg).join(', ')
    });
  }
  next();
};

const proxyGoogleMapsRequest = async (res, endpoint, params) => {
  if (isCircuitOpen()) {
    return res.status(503).json({
      status: 'SERVICE_UNAVAILABLE',
      error_message: 'Maps service is temporarily unavailable. Please retry shortly.'
    });
  }

  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/${endpoint}`, {
      params: {
        ...params,
        key: process.env.GOOGLE_MAPS_API_KEY
      },
      timeout: 15000
    });
    markUpstreamSuccess();

    return res.status(response.status).json(response.data);
  } catch (error) {
    if (!error.response || error.response.status >= 500) {
      markUpstreamFailure();
    }

    if (error.response?.data) {
      const statusCode =
        error.response.status >= 500 ? 502 : error.response.status;
      return res.status(statusCode).json(error.response.data);
    }

    return res.status(502).json({
      status: 'REQUEST_FAILED',
      error_message: 'Unable to reach Google Maps services.'
    });
  }
};

router.get(
  '/geocode',
  [
    query('address').trim().notEmpty().withMessage('address is required'),
    query('country')
      .optional()
      .trim()
      .isLength({ min: 2, max: 2 })
      .withMessage('country must be a 2-letter country code')
  ],
  validate,
  requireMapsApiKey,
  async (req, res) => {
    const country = (req.query.country || 'NG').toUpperCase();
    await proxyGoogleMapsRequest(res, 'geocode/json', {
      address: req.query.address,
      components: `country:${country}`
    });
  }
);

router.get(
  '/autocomplete',
  [
    query('input')
      .trim()
      .isLength({ min: 2 })
      .withMessage('input must be at least 2 characters'),
    query('country')
      .optional()
      .trim()
      .isLength({ min: 2, max: 2 })
      .withMessage('country must be a 2-letter country code'),
    query('types').optional().trim().notEmpty().withMessage('types is invalid')
  ],
  validate,
  requireMapsApiKey,
  async (req, res) => {
    const country = (req.query.country || 'ng').toLowerCase();
    const params = {
      input: req.query.input,
      components: `country:${country}`
    };

    if (req.query.types) {
      params.types = req.query.types;
    }

    await proxyGoogleMapsRequest(res, 'place/autocomplete/json', params);
  }
);

router.get(
  '/directions',
  [
    query('origin').trim().notEmpty().withMessage('origin is required'),
    query('destination')
      .trim()
      .notEmpty()
      .withMessage('destination is required'),
    query('mode')
      .optional()
      .trim()
      .isIn(['driving', 'walking', 'bicycling', 'transit'])
      .withMessage('mode is invalid'),
    query('region')
      .optional()
      .trim()
      .isLength({ min: 2, max: 2 })
      .withMessage('region must be a 2-letter country code')
  ],
  validate,
  requireMapsApiKey,
  async (req, res) => {
    await proxyGoogleMapsRequest(res, 'directions/json', {
      origin: req.query.origin,
      destination: req.query.destination,
      mode: req.query.mode || 'driving',
      region: (req.query.region || 'ng').toLowerCase()
    });
  }
);

module.exports = router;
