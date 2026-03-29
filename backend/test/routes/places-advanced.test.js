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

describeIfIntegration('Places Sync with Transactions', () => {
  let testUser = null;
  let testToken = null;

  beforeAll(async () => {
    // Create test user
    const hashedPassword = await hashPassword('TestPassword123!');
    const userRef = await db.collection('users').add({
      email: 'places-sync-test@example.com',
      name: 'Places Sync Test',
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
    testUser = { _id: userRef.id };

    // Login to get token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'places-sync-test@example.com',
        password: 'TestPassword123!'
      });

    testToken = loginRes.body.data.token;
  });

  afterAll(async () => {
    // Clean up
    if (testUser) {
      // Delete all places
      const placesSnapshot = await db.collection('places')
        .where('userId', '==', testUser._id)
        .get();
      const batch = db.batch();
      placesSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Delete user
      await db.collection('users').doc(testUser._id).delete();
    }
  });

  describe('POST /api/places/sync/push (with transactions)', () => {
    it('should create multiple places atomically', async () => {
      const places = [
        {
          clientId: 'client-1',
          name: 'Restaurant A',
          address: 'Address A',
          latitude: 6.5244,
          longitude: 3.3792,
          category: 'Restaurant'
        },
        {
          clientId: 'client-2',
          name: 'Hotel B',
          address: 'Address B',
          latitude: 6.5256,
          longitude: 3.3810,
          category: 'Hotel'
        }
      ];

      const response = await request(app)
        .post('/api/places/sync/push')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ places });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.applied).toBe(2);
      expect(response.body.data.records.length).toBe(2);
    });

    it('should handle validation errors gracefully', async () => {
      const places = [
        {
          clientId: 'client-3',
          name: 'Valid Place',
          latitude: 6.5244,
          longitude: 3.3792
        },
        {
          clientId: 'client-4',
          name: 'Invalid Place',
          latitude: 200, // Invalid latitude > 90
          longitude: 3.3792
        }
      ];

      const response = await request(app)
        .post('/api/places/sync/push')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ places });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should handle conflicts correctly', async () => {
      // Create a place
      const createRes = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          clientId: 'conflict-1',
          name: 'Original Place',
          address: 'Original Address',
          latitude: 6.5244,
          longitude: 3.3792
        });

      const placeId = createRes.body.data.serverId;
      const originalUpdatedAt = new Date(createRes.body.data.updatedAt);

      // Try to sync with older timestamp (conflict)
      const olderDate = new Date(originalUpdatedAt.getTime() - 3600000);
      const response = await request(app)
        .post('/api/places/sync/push')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          places: [
            {
              serverId: placeId,
              clientId: 'conflict-1',
              name: 'Outdated Place',
              address: 'Outdated Address',
              latitude: 6.5244,
              longitude: 3.3792,
              updatedAt: olderDate.toISOString()
            }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.data.conflicts.length).toBe(1);
      expect(response.body.data.applied).toBe(0);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/places/sync/push')
        .send({
          places: [
            {
              clientId: 'unauth-1',
              name: 'Test Place',
              latitude: 6.5244,
              longitude: 3.3792
            }
          ]
        });

      expect(response.status).toBe(401);
    });

    it('should validate array structure', async () => {
      const response = await request(app)
        .post('/api/places/sync/push')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ places: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Place CRUD with input validation', () => {
    it('should create place with validation', async () => {
      const response = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Test Place',
          address: 'Test Address',
          latitude: 6.5244,
          longitude: 3.3792,
          category: 'Restaurant',
          notes: 'Nice place'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Test Place');
    });

    it('should reject invalid coordinates', async () => {
      const response = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Test Place',
          latitude: 200, // Invalid
          longitude: 3.3792
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should enforce name requirement', async () => {
      const response = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          address: 'Test Address',
          latitude: 6.5244,
          longitude: 3.3792
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should validate category enum', async () => {
      const response = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Test Place',
          latitude: 6.5244,
          longitude: 3.3792,
          category: 'InvalidCategory'
        });

      expect(response.status).toBe(400);
    });

    it('should update place with validation', async () => {
      const createRes = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Original Name',
          latitude: 6.5244,
          longitude: 3.3792
        });

      const placeId = createRes.body.data.serverId;

      const updateRes = await request(app)
        .put(`/api/places/${placeId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Updated Name',
          notes: 'Updated notes'
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Updated Name');
    });

    it('should delete place', async () => {
      const createRes = await request(app)
        .post('/api/places')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Place to Delete',
          latitude: 6.5244,
          longitude: 3.3792
        });

      const placeId = createRes.body.data.serverId;

      const deleteRes = await request(app)
        .delete(`/api/places/${placeId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data.deletedAt).toBeDefined();
    });
  });
});
