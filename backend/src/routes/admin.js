const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { db } = require('../config/firestore');
const { protect, requireAdmin } = require('../middleware/auth');
const { normalizeUserRecord, sanitizeUser } = require('../utils/user');

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

const countDocuments = async (query) => {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count || 0);
};

router.get('/stats', protect, requireAdmin, async (req, res) => {
  try {
    const now = new Date();

    const last24Hours = new Date(now);
    last24Hours.setHours(last24Hours.getHours() - 24);

    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const [totalUsers, activeUsers, newUsers30d, activePlaces, events24h, totalBusinesses, activeBusinesses, verifiedBusinesses] =
      await Promise.all([
        countDocuments(db.collection('users')),
        countDocuments(db.collection('users').where('isActive', '==', true)),
        countDocuments(db.collection('users').where('createdAt', '>=', last30Days)),
        countDocuments(db.collection('places').where('deletedAt', '==', null)),
        countDocuments(db.collection('analyticsEvents').where('occurredAt', '>=', last24Hours)),
        countDocuments(db.collection('businesses')),
        countDocuments(db.collection('businesses').where('isActive', '==', true)),
        countDocuments(db.collection('businesses').where('isVerified', '==', true))
      ]);

    const businessStats = {
      total: totalBusinesses,
      active: activeBusinesses,
      verified: verifiedBusinesses
    };

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          newLast30Days: newUsers30d
        },
        places: {
          active: activePlaces
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
    query('q').optional().trim().isLength({ min: 2, max: 100 })
  ],
  validate,
  async (req, res) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      let baseQuery = db.collection('users');

      if (req.query.role) {
        baseQuery = baseQuery.where('role', '==', req.query.role);
      }
      if (req.query.isActive !== undefined) {
        const isActive = req.query.isActive === 'true';
        baseQuery = baseQuery.where('isActive', '==', isActive);
      }

      let total = 0;
      let paginatedUsers = [];

      if (req.query.q) {
        const regex = new RegExp(req.query.q, 'i');
        const searchScanLimit =
          parseInt(process.env.ADMIN_USER_SEARCH_SCAN_LIMIT, 10) || 500;
        const snapshot = await baseQuery
          .orderBy('createdAt', 'desc')
          .limit(searchScanLimit)
          .get();

        const matchedUsers = snapshot.docs
          .map((doc) => normalizeUserRecord(doc.id, doc.data()))
          .filter((user) => regex.test(user.name || '') || regex.test(user.email || ''));

        total = matchedUsers.length;
        paginatedUsers = matchedUsers.slice(skip, skip + limit).map(sanitizeUser);
      } else {
        total = await countDocuments(baseQuery);
        const snapshot = await baseQuery
          .orderBy('createdAt', 'desc')
          .offset(skip)
          .limit(limit)
          .get();

        paginatedUsers = snapshot.docs
          .map((doc) => normalizeUserRecord(doc.id, doc.data()))
          .map(sanitizeUser);
      }

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
    body('isActive').optional().isBoolean()
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
        updatedAt: new Date()
      };

      const { role, isActive } = req.body;

      if (role !== undefined) {
        updates.role = role;
      }
      if (isActive !== undefined) {
        updates.isActive = Boolean(isActive);
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
