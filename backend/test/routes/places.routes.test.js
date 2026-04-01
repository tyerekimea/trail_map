const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'user-1', role: 'user', isActive: true };
    next();
  }
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
    mapSnapshot,
    toDate
  };
});

const { db } = require('../../src/config/firestore');
const placesRoutes = require('../../src/routes/places');

describe('places routes', () => {
  let app;
  let placesCollection;
  let getPlacesQuery;

  beforeEach(() => {
    getPlacesQuery = jest.fn();
    const placesQuery = {
      where: jest.fn(() => placesQuery),
      limit: jest.fn(() => placesQuery),
      get: getPlacesQuery
    };

    placesCollection = {
      where: jest.fn(() => placesQuery)
    };

    db.collection.mockImplementation((name) => {
      if (name === 'places') return placesCollection;
      throw new Error(`Unexpected collection: ${name}`);
    });

    app = express();
    app.use(express.json());
    app.use('/api/places', placesRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/places returns active places only', async () => {
    getPlacesQuery.mockResolvedValue({
      docs: [
        {
          id: 'srv_1',
          data: () => ({
            userId: 'user-1',
            clientId: 'cp_1',
            name: 'Home',
            address: 'Abuja',
            location: { latitude: 9.05785, longitude: 7.49508 },
            category: 'Home',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: null
          })
        },
        {
          id: 'srv_2',
          data: () => ({
            userId: 'user-1',
            clientId: 'cp_2',
            name: 'Old',
            address: 'Lagos',
            location: { latitude: 6.45, longitude: 3.39 },
            category: 'Other',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: new Date('2026-01-03T00:00:00.000Z')
          })
        }
      ]
    });

    const response = await request(app).get('/api/places');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(1);
    expect(response.body.data[0].serverId).toBe('srv_1');
  });

  test('POST /api/places/sync/push reports missing clientId error', async () => {
    const response = await request(app).post('/api/places/sync/push').send({
      places: [{ name: 'No client id', latitude: 9.0, longitude: 7.0 }]
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors).toBeDefined();
    expect(response.body.errors.length).toBeGreaterThan(0);
  });
});
