const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'user-1', role: 'admin', isActive: true };
    next();
  },
  requireAdmin: (req, res, next) => next()
}));

jest.mock('../../src/config/firestore', () => {
  const mapSnapshot = (doc) => ({
    _id: doc.id,
    id: doc.id,
    ...(doc.data() || {})
  });

  const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  return {
    db: {
      collection: jest.fn()
    },
    FieldValue: {
      increment: (value) => ({ __increment: value })
    },
    mapSnapshot,
    toDate
  };
});

const { db } = require('../../src/config/firestore');
const analyticsRoutes = require('../../src/routes/analytics');

describe('analytics routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/analytics/event stores event and updates usage', async () => {
    const addEvent = jest.fn().mockResolvedValue({ id: 'evt_1' });
    const updateUser = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((name) => {
      if (name === 'analyticsEvents') {
        return { add: addEvent };
      }
      if (name === 'users') {
        return {
          doc: jest.fn(() => ({
            update: updateUser
          }))
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).post('/api/analytics/event').send({
      eventType: 'search_performed',
      value: 1
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(addEvent).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  test('GET /api/analytics/summary returns grouped totals', async () => {
    const docs = [
      {
        id: 'evt_1',
        data: () => ({
          eventType: 'search_performed',
          userId: 'u1',
          occurredAt: new Date('2026-03-20T00:00:00.000Z')
        })
      },
      {
        id: 'evt_2',
        data: () => ({
          eventType: 'navigation_started',
          userId: 'u1',
          occurredAt: new Date('2026-03-20T00:01:00.000Z')
        })
      }
    ];

    const query = {
      where: jest.fn(),
      limit: jest.fn(),
      get: jest.fn().mockResolvedValue({ docs })
    };
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);

    db.collection.mockImplementation((name) => {
      if (name === 'analyticsEvents') return query;
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).get('/api/analytics/summary').query({
      days: 30
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totals.totalEvents).toBe(2);
    expect(response.body.data.totals.activeUsers).toBe(1);
  });
});
