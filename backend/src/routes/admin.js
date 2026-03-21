const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { db, mapSnapshot, toDate } = require('../config/firestore');
const { protect, requireAdmin } = require('../middleware/auth');
const { normalizeUserRecord, sanitizeUser, isPremiumActive } = require('../utils/user');

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

const mapFirestoreDoc = (doc) => ({
  ...mapSnapshot(doc),
  createdAt: toDate(doc.data()?.createdAt),
  updatedAt: toDate(doc.data()?.updatedAt)
});

router.get('/stats', protect, requireAdmin, async (req, res) => {
  try {
    const now = new Date();

    const last24Hours = new Date(now);
    last24Hours.setHours(last24Hours.getHours() - 24);

    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const [usersSnap, placesSnap, subscriptionsSnap, eventsSnap, businessesSnap] =
      await Promise.all([
        db.collection('users').get(),
        db.collection('places').get(),
        db.collection('subscriptions').get(),
        db.collection('analyticsEvents').get(),
        db.collection('businesses').get()
      ]);

    const users = usersSnap.docs.map((doc) => normalizeUserRecord(doc.id, doc.data()));
    const places = placesSnap.docs.map(mapFirestoreDoc);
    const subscriptions = subscriptionsSnap.docs.map(mapFirestoreDoc);
    const events = eventsSnap.docs.map(mapFirestoreDoc);
    const businesses = businessesSnap.docs.map(mapFirestoreDoc);

    const totalUsers = users.length;
    const activeUsers = users.filter((user) => user.isActive).length;
    const premiumUsers = users.filter((user) => isPremiumActive(user)).length;
    const newUsers30d = users.filter((user) => user.createdAt && user.createdAt >= last30Days).length;

    const activePlaces = places.filter((place) => !place.deletedAt).length;

    const successfulSubscriptions = subscriptions.filter(
      (subscription) => subscription.status === 'success'
    ).length;
    const pendingSubscriptions = subscriptions.filter(
      (subscription) => subscription.status === 'pending'
    ).length;
    const revenueNgn = subscriptions
      .filter((subscription) => subscription.status === 'success')
      .reduce((sum, subscription) => sum + Number(subscription.amount || 0), 0);

    const events24h = events.filter((event) => {
      const occurredAt = toDate(event.occurredAt);
      return occurredAt && occurredAt >= last24Hours;
    }).length;

    const businessStats = {
      total: businesses.length,
      active: businesses.filter((business) => business.isActive !== false).length,
      verified: businesses.filter((business) => business.isVerified === true).length
    };

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          premium: premiumUsers,
          newLast30Days: newUsers30d
        },
        places: {
          active: activePlaces
        },
        subscriptions: {
          successful: successfulSubscriptions,
          pending: pendingSubscriptions,
          revenueNgn
        },
        analytics: {
          eventsLast24Hours: events24h
        },
        businesses: businessStats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Unable to load admin stats',
      error: error.message
    });
  }
});

router.get(
  '/users',
  protect,
  requireAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('role').optional().isIn(['user', 'admin']),
    query('isActive').optional().isBoolean(),
    query('isPremium').optional().isBoolean(),
    query('q').optional().trim().isLength({ min: 2, max: 100 })
  ],
  validate,
  async (req, res) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const snapshot = await db.collection('users').get();
      let users = snapshot.docs.map((doc) => normalizeUserRecord(doc.id, doc.data()));

      if (req.query.role) {
        users = users.filter((user) => user.role === req.query.role);
      }
      if (req.query.isActive !== undefined) {
        const isActive = req.query.isActive === 'true';
        users = users.filter((user) => Boolean(user.isActive) === isActive);
      }
      if (req.query.isPremium !== undefined) {
        const isPremium = req.query.isPremium === 'true';
        users = users.filter((user) => isPremiumActive(user) === isPremium);
      }
      if (req.query.q) {
        const regex = new RegExp(req.query.q, 'i');
        users = users.filter((user) => regex.test(user.name || '') || regex.test(user.email || ''));
      }

      users.sort((a, b) => {
        const aDate = a.createdAt || new Date(0);
        const bDate = b.createdAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });

      const total = users.length;
      const paginatedUsers = users.slice(skip, skip + limit).map(sanitizeUser);

      res.json({
        success: true,
        data: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          users: paginatedUsers
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to fetch users',
        error: error.message
      });
    }
  }
);

router.patch(
  '/users/:id',
  protect,
  requireAdmin,
  [
    param('id').trim().notEmpty().withMessage('Invalid user id'),
    body('role').optional().isIn(['user', 'admin']),
    body('isActive').optional().isBoolean(),
    body('isPremium').optional().isBoolean(),
    body('premiumExpiry')
      .optional({ values: 'falsy' })
      .isISO8601()
      .withMessage('premiumExpiry must be an ISO date')
  ],
  validate,
  async (req, res) => {
    try {
      const userRef = db.collection('users').doc(req.params.id);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const updates = {
        updatedAt: new Date(),
        premiumUpdatedAt: new Date()
      };

      const { role, isActive, isPremium, premiumExpiry } = req.body;

      if (role !== undefined) {
        updates.role = role;
      }
      if (isActive !== undefined) {
        updates.isActive = Boolean(isActive);
      }
      if (isPremium !== undefined) {
        updates.isPremium = Boolean(isPremium);
      }

      if (premiumExpiry !== undefined) {
        updates.premiumExpiry = premiumExpiry ? new Date(premiumExpiry) : null;
      }

      if (isPremium === false) {
        updates.premiumExpiry = null;
        updates.premiumPlan = null;
      }

      await userRef.set(updates, { merge: true });
      const updatedDoc = await userRef.get();
      const updatedUser = sanitizeUser(normalizeUserRecord(updatedDoc.id, updatedDoc.data()));

      res.json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to update user',
        error: error.message
      });
    }
  }
);

module.exports = router;
