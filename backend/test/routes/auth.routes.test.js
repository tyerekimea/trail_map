const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/firestore', () => {
  const mockCollection = jest.fn();

  const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  return {
    db: {
      collection: mockCollection,
    },
    toDate,
  };
});

const { db } = require('../../src/config/firestore');
const authRoutes = require('../../src/routes/auth');

describe('auth routes', () => {
  let app;
  let userCollection;
  let usersQueryGet;
  let usersAdd;
  let usersDocUpdate;
  let refreshTokenSet;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
    process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
    process.env.JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '1d';
  });

  beforeEach(() => {
    usersQueryGet = jest.fn();
    usersAdd = jest.fn();
    usersDocUpdate = jest.fn();
    refreshTokenSet = jest.fn().mockResolvedValue(undefined);

    userCollection = {
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: usersQueryGet,
        })),
      })),
      add: usersAdd,
      doc: jest.fn(() => ({
        update: usersDocUpdate,
      })),
    };

    const refreshTokenCollection = {
      doc: jest.fn(() => ({
        set: refreshTokenSet,
      })),
    };

    db.collection.mockImplementation((name) => {
      if (name === 'users') return userCollection;
      if (name === 'refreshTokens') return refreshTokenCollection;
      throw new Error(`Unexpected collection: ${name}`);
    });

    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/auth/register returns 201 for valid payload', async () => {
    usersQueryGet.mockResolvedValue({ empty: true, docs: [] });
    usersAdd.mockResolvedValue({ id: 'user-1' });

    const response = await request(app).post('/api/auth/register').send({
      email: 'route-test@example.com',
      password: 'Password123!',
      name: 'Route Test User',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('route-test@example.com');
    expect(response.body.data.user.password).toBeUndefined();
    expect(typeof response.body.data.token).toBe('string');
    expect(typeof response.body.data.refreshToken).toBe('string');
    expect(usersAdd).toHaveBeenCalledTimes(1);
    expect(refreshTokenSet).toHaveBeenCalledTimes(1);
  });

  test('POST /api/auth/login returns 401 when user is missing', async () => {
    usersQueryGet.mockResolvedValue({ empty: true, docs: [] });

    const response = await request(app).post('/api/auth/login').send({
      email: 'missing@example.com',
      password: 'Password123!',
    });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/Invalid email or password/i);
  });

  test('POST /api/auth/refresh returns 401 when token is missing', async () => {
    const response = await request(app).post('/api/auth/refresh').send({});

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/Refresh token required/i);
  });
});
