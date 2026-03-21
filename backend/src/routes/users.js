const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../config/firestore');
const { normalizeUserRecord, sanitizeUser } = require('../utils/user');
const { protect } = require('../middleware/auth');

router.get('/profile', protect, async (req, res) => {
  res.json({ success: true, data: req.user });
});

router.put(
  '/profile',
  protect,
  [
    body('name').optional().trim().isLength({ min: 1, max: 120 }),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ min: 6, max: 24 }),
    body('deviceInfo').optional().isObject().withMessage('deviceInfo must be an object')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const updates = {
        updatedAt: new Date()
      };

      if (req.body.name !== undefined) {
        updates.name = String(req.body.name).trim();
      }

      if (req.body.phone !== undefined) {
        updates.phone = req.body.phone ? String(req.body.phone).trim() : null;
      }

      if (req.body.deviceInfo !== undefined) {
        updates.deviceInfo = req.body.deviceInfo || {};
      }

      await db.collection('users').doc(req.user._id).update(updates);
      const updatedUserDoc = await db.collection('users').doc(req.user._id).get();
      const updatedUser = sanitizeUser(
        normalizeUserRecord(updatedUserDoc.id, updatedUserDoc.data())
      );

      return res.json({
        success: true,
        message: 'Profile updated',
        data: updatedUser
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to update profile',
        error: error.message
      });
    }
  }
);

router.get('/usage', protect, async (req, res) => {
  res.json({ success: true, data: req.user.usage });
});

module.exports = router;
