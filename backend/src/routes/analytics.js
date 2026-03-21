const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db, FieldValue, mapSnapshot, toDate } = require('../config/firestore');
const { protect, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  next();
};

const parseWindow = ({ days = 7, startDate, endDate }) => {
  const now = new Date();

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : now;

    return {
      start,
      end
    };
  }

  const normalizedDays = Number(days) || 7;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - normalizedDays);

  return {
    start,
    end: now
  };
};

const mapEvent = (doc) => {
  const event = mapSnapshot(doc);
  return {
    ...event,
    occurredAt: toDate(event.occurredAt),
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt)
  };
};

router.post(
  '/event',
  protect,
  [
    body('eventType')
      .trim()
      .notEmpty()
      .isLength({ min: 2, max: 64 })
      .withMessage('eventType is required'),
    body('screen').optional().trim().isLength({ max: 100 }),
    body('action').optional().trim().isLength({ max: 100 }),
    body('label').optional().trim().isLength({ max: 200 }),
    body('entityType').optional().trim().isLength({ max: 50 }),
    body('entityId').optional().trim().isLength({ max: 120 }),
    body('value').optional().isFloat(),
    body('metadata').optional().isObject().withMessage('metadata must be an object'),
    body('occurredAt')
      .optional()
      .isISO8601()
      .withMessage('occurredAt must be an ISO 8601 date')
  ],
  validate,
  async (req, res) => {
    try {
      const {
        eventType,
        screen,
        action,
        label,
        value,
        metadata,
        entityType,
        entityId,
        platform,
        appVersion,
        occurredAt
      } = req.body;

      const now = new Date();
      const payload = {
        userId: req.user._id,
        eventType,
        screen,
        action,
        label,
        value: value || 0,
        metadata: metadata || {},
        entityType,
        entityId,
        platform,
        appVersion,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || '',
        occurredAt: occurredAt ? new Date(occurredAt) : now,
        createdAt: now,
        updatedAt: now
      };

      const eventRef = await db.collection('analyticsEvents').add(payload);

      const usageIncrements = {};
      if (eventType === 'search_performed') {
        usageIncrements['usage.totalSearches'] = FieldValue.increment(1);
      }
      if (eventType === 'navigation_started') {
        usageIncrements['usage.totalNavigations'] = FieldValue.increment(1);
      }
      if (eventType === 'distance_travelled') {
        usageIncrements['usage.totalDistance'] = FieldValue.increment(Number(value || 0));
      }

      if (Object.keys(usageIncrements).length > 0) {
        usageIncrements.updatedAt = now;
        await db.collection('users').doc(req.user._id).update(usageIncrements);
      }

      res.status(201).json({
        success: true,
        message: 'Event tracked',
        data: {
          id: eventRef.id,
          eventType,
          occurredAt: payload.occurredAt
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to track analytics event',
        error: error.message
      });
    }
  }
);

router.get(
  '/summary',
  protect,
  requireAdmin,
  [
    query('days').optional().isInt({ min: 1, max: 365 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  validate,
  async (req, res) => {
    try {
      const { start, end } = parseWindow(req.query);
      const snapshot = await db.collection('analyticsEvents').get();

      const filtered = snapshot.docs
        .map(mapEvent)
        .filter((event) => event.occurredAt && event.occurredAt >= start && event.occurredAt <= end);

      const eventTypeCounts = new Map();
      const activeUsers = new Set();

      filtered.forEach((event) => {
        eventTypeCounts.set(event.eventType, (eventTypeCounts.get(event.eventType) || 0) + 1);
        if (event.userId) {
          activeUsers.add(event.userId);
        }
      });

      const eventsByType = Array.from(eventTypeCounts.entries())
        .map(([eventType, count]) => ({ eventType, count }))
        .sort((a, b) => b.count - a.count);

      res.json({
        success: true,
        data: {
          window: {
            start,
            end
          },
          totals: {
            totalEvents: filtered.length,
            activeUsers: activeUsers.size
          },
          eventsByType
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to load analytics summary',
        error: error.message
      });
    }
  }
);

router.get(
  '/events',
  protect,
  requireAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('eventType').optional().trim().isLength({ min: 2, max: 64 }),
    query('userId').optional().trim().isLength({ min: 3, max: 128 })
  ],
  validate,
  async (req, res) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const snapshot = await db.collection('analyticsEvents').get();
      let events = snapshot.docs.map(mapEvent);

      if (req.query.eventType) {
        events = events.filter((event) => event.eventType === req.query.eventType);
      }

      if (req.query.userId) {
        events = events.filter((event) => event.userId === req.query.userId);
      }

      events.sort((a, b) => {
        const aDate = a.occurredAt || new Date(0);
        const bDate = b.occurredAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });

      const total = events.length;
      const paginated = events.slice(skip, skip + limit);

      res.json({
        success: true,
        data: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          events: paginated
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to fetch analytics events',
        error: error.message
      });
    }
  }
);

module.exports = router;
