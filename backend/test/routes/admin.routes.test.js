const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'admin-1', role: 'admin', isActive: true };
    next();
  },
  requireAdmin: (req, res, next) => next()
}));

jest.mock('../../src/config/firestore', () => ({
  db: {
    collection: jest.fn()
  },
  toDate: (value) => value
}));

const { db } = require('../../src/config/firestore');
const adminRoutes = require('../../src/routes/admin');

const countResult = (count) => ({
  count: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({
      data: () => ({ count })
    })
  }))
});

describe('admin routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/admin/stats returns aggregated counts', async () => {
    const usersCollection = {
      ...countResult(12),
      where: jest.fn((field, op, value) => {
        if (field === 'isActive' && value === true) return countResult(10);
        if (field === 'createdAt' && op === '>=') return countResult(3);
        return countResult(0);
      })
    };

    const placesCollection = {
      where: jest.fn(() => countResult(24))
    };

    const analyticsCollection = {
      where: jest.fn(() => countResult(7))
    };

    const businessesCollection = {
      ...countResult(20),
      where: jest.fn((field, op, value) => {
        if (field === 'isActive' && value === true) return countResult(16);
        if (field === 'isVerified' && value === true) return countResult(8);
        return countResult(0);
      })
    };

    db.collection.mockImplementation((name) => {
      if (name === 'users') return usersCollection;
      if (name === 'places') return placesCollection;
      if (name === 'analyticsEvents') return analyticsCollection;
      if (name === 'businesses') return businessesCollection;
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).get('/api/admin/stats');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.users.total).toBe(12);
    expect(response.body.data.businesses.verified).toBe(8);
  });

  test('GET /api/admin/users paginates users without full scan path', async () => {
    const usersQuery = {
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          data: () => ({ count: 2 })
        })
      })),
      where: jest.fn(),
      orderBy: jest.fn(),
      offset: jest.fn(),
      limit: jest.fn(),
      get: jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'u_1',
            data: () => ({
              email: 'user1@example.com',
              name: 'User One',
              password: 'hash',
              role: 'user',
              isActive: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z')
            })
          },
          {
            id: 'u_2',
            data: () => ({
              email: 'user2@example.com',
              name: 'User Two',
              password: 'hash',
              role: 'user',
              isActive: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z')
            })
          }
        ]
      })
    };
    usersQuery.where.mockReturnValue(usersQuery);
    usersQuery.orderBy.mockReturnValue(usersQuery);
    usersQuery.offset.mockReturnValue(usersQuery);
    usersQuery.limit.mockReturnValue(usersQuery);

    db.collection.mockImplementation((name) => {
      if (name === 'users') return usersQuery;
      throw new Error(`Unexpected collection: ${name}`);
    });

    const response = await request(app).get('/api/admin/users').query({
      page: 1,
      limit: 20
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.users).toHaveLength(2);
    expect(response.body.data.users[0].password).toBeUndefined();
  });
});
