const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'admin-1', role: 'admin', isActive: true };
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
const businessesRoutes = require('../../src/routes/businesses');

describe('businesses routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/businesses', businessesRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/businesses/search filters by query text', async () => {
    const docs = [
      {
        id: 'biz_1',
        data: () => ({
          name: 'City Clinic',
          description: '24/7 clinic',
          category: 'Health',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          analytics: { views: 10, clicks: 2 }
        })
      },
      {
        id: 'biz_2',
        data: () => ({
          name: 'Auto Garage',
          description: 'Vehicle repairs',
          category: 'Automotive',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          analytics: { views: 4, clicks: 1 }
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
      if (name === 'businesses') return query;
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).get('/api/businesses/search').query({
      q: 'clinic'
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.businesses[0].name).toBe('City Clinic');
  });

  test('POST /api/businesses/:id/view increments views', async () => {
    const businessRef = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'biz_1',
          exists: true,
          data: () => ({
            name: 'City Clinic',
            isActive: true,
            analytics: { views: 10, clicks: 2 }
          })
        })
        .mockResolvedValueOnce({
          id: 'biz_1',
          exists: true,
          data: () => ({
            name: 'City Clinic',
            isActive: true,
            analytics: { views: 11, clicks: 2 }
          })
        }),
      update: jest.fn().mockResolvedValue(undefined)
    };

    db.collection.mockImplementation((name) => {
      if (name === 'businesses') {
        return {
          doc: jest.fn(() => businessRef)
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).post('/api/businesses/biz_1/view');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.views).toBe(11);
    expect(businessRef.update).toHaveBeenCalledTimes(1);
  });
});
