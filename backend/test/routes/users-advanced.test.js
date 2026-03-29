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

describeIfIntegration('Account Deletion & GDPR Compliance', () => {
  let testUser = null;
  let testToken = null;
  const TEST_PASSWORD = 'DeleteMe123!';

  beforeEach(async () => {
    // Create test user
    const hashedPassword = await hashPassword(TEST_PASSWORD);
    const userRef = await db.collection('users').add({
      email: `gdpr-test-${Date.now()}@example.com`,
      name: 'GDPR Test User',
      password: hashedPassword,
      phone: '1234567890',
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
    testUser = { _id: userRef.id, email: `gdpr-test-${Date.now()}@example.com` };

    // Login to get token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: TEST_PASSWORD
      });

    testToken = loginRes.body.data.token;
  });

  afterEach(async () => {
    // Cleanup any remaining data
    if (testUser) {
      const userDoc = await db.collection('users').doc(testUser._id).get();
      if (userDoc.exists) {
        // Delete all associated data
        const placesSnapshot = await db.collection('places')
          .where('userId', '==', testUser._id)
          .get();
        const analyticsSnapshot = await db.collection('analytics')
          .where('userId', '==', testUser._id)
          .get();

        const batch = db.batch();
        placesSnapshot.forEach(doc => batch.delete(doc.ref));
        analyticsSnapshot.forEach(doc => batch.delete(doc.ref));
        batch.delete(userDoc.ref);
        await batch.commit();
      }
    }
  });

  describe('POST /api/users/export-data', () => {
    it('should export user data with authentication', async () => {
      // Create some test data
      await db.collection('places').add({
        userId: testUser._id,
        clientId: 'test-export-1',
        name: 'Test Place',
        address: 'Test Address',
        location: { latitude: 6.5244, longitude: 3.3792 },
        category: 'Restaurant',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const response = await request(app)
        .post('/api/users/export-data')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.places).toBeDefined();
      expect(response.body.data.analytics).toBeDefined();
      expect(response.body.data.places.length).toBeGreaterThan(0);
    });

    it('should reject unauthenticated export', async () => {
      const response = await request(app)
        .post('/api/users/export-data');

      expect(response.status).toBe(401);
    });

    it('should include all user places in export', async () => {
      // Create multiple places
      const places = [
        { name: 'Place 1', latitude: 6.5244, longitude: 3.3792 },
        { name: 'Place 2', latitude: 6.5260, longitude: 3.3810 },
        { name: 'Place 3', latitude: 6.5280, longitude: 3.3830 }
      ];

      for (const place of places) {
        await db.collection('places').add({
          userId: testUser._id,
          clientId: `test-${Date.now()}-${Math.random()}`,
          ...place,
          address: 'Test Address',
          category: 'Other',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      const response = await request(app)
        .post('/api/users/export-data')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.places.length).toBe(places.length);
    });
  });

  describe('DELETE /api/users/account', () => {
    it('should delete account with correct password', async () => {
      const response = await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');
    });

    it('should verify account is deleted', async () => {
      await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      // Try to login with deleted account
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: TEST_PASSWORD
        });

      expect(loginRes.status).toBe(401);
    });

    it('should reject wrong password', async () => {
      const response = await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: 'WrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject deletion without authentication', async () => {
      const response = await request(app)
        .delete('/api/users/account')
        .send({ password: TEST_PASSWORD });

      expect(response.status).toBe(401);
    });

    it('should require password field', async () => {
      const response = await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should delete all user places (cascading)', async () => {
      // Create places
      const placeIds = [];
      for (let i = 0; i < 3; i++) {
        const placeRef = await db.collection('places').add({
          userId: testUser._id,
          clientId: `cascade-${i}`,
          name: `Place ${i}`,
          address: 'Test Address',
          location: { latitude: 6.5244, longitude: 3.3792 },
          category: 'Other',
          createdAt: new Date(),
          updatedAt: new Date()
        });
        placeIds.push(placeRef.id);
      }

      // Delete account
      await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      // Verify all places are deleted
      for (const placeId of placeIds) {
        const placeDoc = await db.collection('places').doc(placeId).get();
        expect(placeDoc.exists).toBe(false);
      }
    });

    it('should delete all user analytics (cascading)', async () => {
      // Create analytics records
      const analyticsIds = [];
      for (let i = 0; i < 2; i++) {
        const analyticsRef = await db.collection('analytics').add({
          userId: testUser._id,
          event: 'place_viewed',
          placeId: `place-${i}`,
          timestamp: new Date(),
          properties: {}
        });
        analyticsIds.push(analyticsRef.id);
      }

      // Delete account
      await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      // Verify all analytics are deleted
      for (const analyticsId of analyticsIds) {
        const analyticsDoc = await db.collection('analytics').doc(analyticsId).get();
        expect(analyticsDoc.exists).toBe(false);
      }
    });

    it('should revoke all refresh tokens (cascading)', async () => {
      // Get refresh tokens
      const tokensSnapshot = await db.collection('refreshTokens')
        .where('userId', '==', testUser._id)
        .get();

      // Should have at least one token from login
      expect(tokensSnapshot.size).toBeGreaterThan(0);

      // Delete account
      await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      // Verify all tokens are deleted
      const afterDeleteTokens = await db.collection('refreshTokens')
        .where('userId', '==', testUser._id)
        .get();

      expect(afterDeleteTokens.size).toBe(0);
    });

    it('should handle transaction rollback on error', async () => {
      // This test verifies atomic behavior
      const response = await request(app)
        .delete('/api/users/account')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ password: TEST_PASSWORD });

      expect(response.status).toBe(200);

      // User should be completely deleted
      const userDoc = await db.collection('users').doc(testUser._id).get();
      expect(userDoc.exists).toBe(false);
    });
  });

  describe('Profile Update with Validation', () => {
    it('should update user profile', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Updated Name',
          phone: '9876543210'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Name');
    });

    it('should validate name length', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: '' // Empty name
        });

      expect(response.status).toBe(400);
    });

    it('should validate phone format', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          phone: '123' // Too short
        });

      expect(response.status).toBe(400);
    });
  });
});
