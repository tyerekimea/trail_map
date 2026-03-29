const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIfIntegration = runIntegration ? describe : describe.skip;

let request;
let app;
let db;
let hashPassword;

if (runIntegration) {
  request = require('supertest');
  app = require('../../src/server');
  ({ db } = require('../../src/config/firestore'));
  ({ hashPassword } = require('../../src/utils/user'));
}

describeIfIntegration('Password Reset Flow', () => {
  let testEmailUser = null;
  const TEST_EMAIL = 'reset-test@example.com';
  const TEST_PASSWORD = 'TestPassword123!';

  beforeAll(async () => {
    // Create a test user
    const hashedPassword = await hashPassword(TEST_PASSWORD);
    const userRef = await db.collection('users').add({
      email: TEST_EMAIL,
      name: 'Reset Test User',
      password: hashedPassword,
      phone: null,
      authProvider: 'email',
      authId: null,
      deviceInfo: {},
      usage: { places: 0, syncs: 0 },
      lastLogin: new Date(),
      isActive: true,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    testEmailUser = { _id: userRef.id, email: TEST_EMAIL };
  });

  afterAll(async () => {
    // Clean up
    if (testEmailUser) {
      await db.collection('users').doc(testEmailUser._id).delete();
    }
  });

  describe('POST /api/auth/password-reset-request', () => {
    it('should return success for valid email (no user disclosure)', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: TEST_EMAIL });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('password reset link');
    });

    it('should return success for non-existent email (user privacy)', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should validate reset token was stored', async () => {
      await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: TEST_EMAIL });

      const userDoc = await db.collection('users').doc(testEmailUser._id).get();
      const userData = userDoc.data();
      expect(userData.passwordResetToken).toBeDefined();
      expect(userData.passwordResetExpires).toBeDefined();
    });
  });

  describe('POST /api/auth/password-reset', () => {
    let resetToken = null;

    beforeEach(async () => {
      // Generate fresh reset token
      const crypto = require('crypto');
      resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpires = new Date(Date.now() + 3600000);

      await db.collection('users').doc(testEmailUser._id).update({
        passwordResetToken: resetTokenHash,
        passwordResetExpires: resetTokenExpires
      });
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewPassword456!';
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({
          email: TEST_EMAIL,
          token: resetToken,
          newPassword: newPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({
          email: TEST_EMAIL,
          token: 'invalid-token-that-is-too-short-for-validation',
          newPassword: 'AnyPassword123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject expired token', async () => {
      // Set token to expired
      const crypto = require('crypto');
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
      const expiredDate = new Date(Date.now() - 7200000); // 2 hours ago

      await db.collection('users').doc(testEmailUser._id).update({
        passwordResetToken: tokenHash,
        passwordResetExpires: expiredDate
      });

      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({
          email: TEST_EMAIL,
          token: expiredToken,
          newPassword: 'AnyPassword123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('expired');
    });

    it('should require minimum password length', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset')
        .send({
          email: TEST_EMAIL,
          token: resetToken,
          newPassword: '12345' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should clear reset token after successful reset', async () => {
      const newPassword = 'AnotherPassword789!';
      await request(app)
        .post('/api/auth/password-reset')
        .send({
          email: TEST_EMAIL,
          token: resetToken,
          newPassword: newPassword
        });

      const userDoc = await db.collection('users').doc(testEmailUser._id).get();
      const userData = userDoc.data();
      expect(userData.passwordResetToken).toBeNull();
      expect(userData.passwordResetExpires).toBeNull();
    });
  });
});

describeIfIntegration('Auth Logout', () => {
  let testUser = null;
  let testToken = null;
  let testRefreshToken = null;

  beforeAll(async () => {
    // Register test user
    const hashedPassword = await hashPassword('TestPassword123!');
    const userRef = await db.collection('users').add({
      email: 'logout-test@example.com',
      name: 'Logout Test User',
      password: hashedPassword,
      phone: null,
      authProvider: 'email',
      authId: null,
      deviceInfo: {},
      usage: { places: 0, syncs: 0 },
      lastLogin: new Date(),
      isActive: true,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    testUser = { _id: userRef.id, email: 'logout-test@example.com' };

    // Login to get tokens
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'logout-test@example.com',
        password: 'TestPassword123!'
      });

    testToken = loginRes.body.data.token;
    testRefreshToken = loginRes.body.data.refreshToken;
  });

  afterAll(async () => {
    if (testUser) {
      await db.collection('users').doc(testUser._id).delete();
    }
  });

  describe('POST /api/auth/logout', () => {
    it('should logout authenticated user', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ refreshToken: testRefreshToken });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject logout without authentication', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: testRefreshToken });

      expect(response.status).toBe(401);
    });

    it('should revoke refresh token after logout', async () => {
      const newLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logout-test@example.com',
          password: 'TestPassword123!'
        });

      const newToken = newLoginRes.body.data.token;
      const newRefreshToken = newLoginRes.body.data.refreshToken;

      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${newToken}`)
        .send({ refreshToken: newRefreshToken });

      // Try to refresh with revoked token
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: newRefreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });
});
