const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../config/firestore');
const { normalizeUserRecord, sanitizeUser } = require('../utils/user');
const { protect } = require('../middleware/auth');
const { comparePassword } = require('../utils/user');
const { sendAccountDeletionConfirmationEmail } = require('../utils/email');
const logger = require('../utils/logger');
const { writeAuditLog } = require('../utils/audit');

const deleteUserCollectionDocs = async (collectionName, userId) => {
  const snapshot = await db.collection(collectionName).where('userId', '==', userId).get();
  if (snapshot.empty) {
    return 0;
  }

  const docs = snapshot.docs;
  let deletedCount = 0;
  let batch = db.batch();
  let operations = 0;

  for (const doc of docs) {
    batch.delete(doc.ref);
    operations += 1;
    deletedCount += 1;

    if (operations >= 450) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }

  if (operations > 0) {
    await batch.commit();
  }

  return deletedCount;
};

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

/**
 * Export user data (GDPR compliance)
 * @swagger
 * /api/users/export-data:
 *   post:
 *     summary: Export user data in JSON format
 */
router.post('/export-data', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Collect all user data
    const userDoc = await db.collection('users').doc(userId).get();
    const placesSnapshot = await db.collection('places').where('userId', '==', userId).get();
    const analyticsSnapshot = await db.collection('analytics').where('userId', '==', userId).get();
    const analyticsEventsSnapshot = await db
      .collection('analyticsEvents')
      .where('userId', '==', userId)
      .get();
    
    const userData = {
      user: userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null,
      places: [],
      analytics: []
    };

    placesSnapshot.forEach(doc => {
      userData.places.push({ id: doc.id, ...doc.data() });
    });

    analyticsSnapshot.forEach(doc => {
      userData.analytics.push({ id: doc.id, ...doc.data() });
    });
    analyticsEventsSnapshot.forEach(doc => {
      userData.analytics.push({ id: doc.id, ...doc.data() });
    });

    logger.info('User data exported', { userId });
    void writeAuditLog({
      action: 'user.export_data',
      actorId: userId,
      targetId: userId,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        placesCount: userData.places.length,
        analyticsCount: userData.analytics.length
      }
    });

    return res.json({
      success: true,
      message: 'User data exported successfully',
      data: userData
    });
  } catch (error) {
    logger.error('Failed to export user data', { userId: req.user._id, error });
    void writeAuditLog({
      action: 'user.export_data',
      actorId: req.user?._id,
      targetId: req.user?._id,
      status: 'failed',
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      metadata: { error: error.message }
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error.message
    });
  }
});

/**
 * Delete user account and all associated data (GDPR compliance)
 * @swagger
 * /api/users/account:
 *   delete:
 *     summary: Permanently delete user account and all data
 */
router.delete(
  '/account',
  protect,
  [body('password').notEmpty().withMessage('Password required for account deletion')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const userId = req.user._id;
      const { password } = req.body;

      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists || userDoc.data()?.isActive === false) {
        return res.status(404).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      const currentUser = normalizeUserRecord(userDoc.id, userDoc.data());
      // Verify password against stored hash (req.user is sanitized and has no password field).
      const passwordMatch = await comparePassword(password, currentUser.password);
      if (!passwordMatch) {
        void writeAuditLog({
          action: 'user.delete_account',
          actorId: userId,
          targetId: userId,
          status: 'denied',
          requestId: req.requestId,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          metadata: { reason: 'invalid_password' }
        });
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }

      const userEmail = currentUser.email;

      await deleteUserCollectionDocs('places', userId);
      await deleteUserCollectionDocs('analytics', userId);
      await deleteUserCollectionDocs('analyticsEvents', userId);
      await deleteUserCollectionDocs('refreshTokens', userId);
      await db.collection('users').doc(userId).delete();

      sendAccountDeletionConfirmationEmail(userEmail).catch((emailError) => {
        logger.warn('Account deletion email failed', {
          userId,
          email: userEmail,
          error: emailError?.message || String(emailError)
        });
      });

      logger.info('User account deleted', { userId, email: userEmail });
      void writeAuditLog({
        action: 'user.delete_account',
        actorId: userId,
        targetId: userId,
        requestId: req.requestId,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      return res.status(200).json({
        success: true,
        message: 'Account deleted successfully. All personal data has been removed.'
      });
    } catch (error) {
      logger.error('Failed to delete user account', { userId: req.user._id, error });
      void writeAuditLog({
        action: 'user.delete_account',
        actorId: req.user?._id,
        targetId: req.user?._id,
        status: 'failed',
        requestId: req.requestId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { error: error.message }
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to delete account',
        error: error.message
      });
    }
  }
);

module.exports = router;
