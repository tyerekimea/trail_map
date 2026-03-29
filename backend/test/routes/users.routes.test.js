const express = require('express');
const request = require('supertest');

const mockComparePassword = jest.fn();
const mockSendAccountDeletionConfirmationEmail = jest.fn();

jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = {
      _id: 'user_1',
      email: 'user@example.com',
      role: 'user',
      isActive: true
    };
    next();
  }
}));

jest.mock('../../src/utils/user', () => ({
  normalizeUserRecord: (id, data = {}) => ({
    _id: id,
    id,
    ...data,
    isActive: data.isActive !== false
  }),
  sanitizeUser: (user) => {
    if (!user) return null;
    const output = { ...user };
    delete output.password;
    return output;
  },
  comparePassword: (...args) => mockComparePassword(...args)
}));

jest.mock('../../src/utils/email', () => ({
  sendAccountDeletionConfirmationEmail: (...args) =>
    mockSendAccountDeletionConfirmationEmail(...args)
}));

jest.mock('../../src/config/firestore', () => ({
  db: {
    collection: jest.fn(),
    batch: jest.fn()
  }
}));

const { db } = require('../../src/config/firestore');
const usersRoutes = require('../../src/routes/users');

describe('users routes', () => {
  let app;
  let userDocRef;

  const emptySnapshot = { empty: true, docs: [] };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', usersRoutes);

    mockComparePassword.mockReset();
    mockSendAccountDeletionConfirmationEmail.mockReset();
    mockSendAccountDeletionConfirmationEmail.mockResolvedValue(true);

    userDocRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          email: 'user@example.com',
          password: 'stored_password_hash',
          isActive: true
        })
      }),
      delete: jest.fn().mockResolvedValue(undefined)
    };

    db.batch.mockReturnValue({
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    });

    db.collection.mockImplementation((name) => {
      if (name === 'users') {
        return {
          doc: jest.fn(() => userDocRef)
        };
      }

      return {
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(emptySnapshot)
        }))
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('DELETE /api/users/account deletes account with correct password', async () => {
    mockComparePassword.mockResolvedValue(true);

    const response = await request(app)
      .delete('/api/users/account')
      .send({ password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockComparePassword).toHaveBeenCalledWith(
      'correct-password',
      'stored_password_hash'
    );
    expect(userDocRef.delete).toHaveBeenCalledTimes(1);
    expect(mockSendAccountDeletionConfirmationEmail).toHaveBeenCalledWith(
      'user@example.com'
    );
  });

  test('DELETE /api/users/account rejects invalid password', async () => {
    mockComparePassword.mockResolvedValue(false);

    const response = await request(app)
      .delete('/api/users/account')
      .send({ password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(userDocRef.delete).not.toHaveBeenCalled();
  });

  test('DELETE /api/users/account validates required password', async () => {
    const response = await request(app).delete('/api/users/account').send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(mockComparePassword).not.toHaveBeenCalled();
    expect(userDocRef.delete).not.toHaveBeenCalled();
  });
});
