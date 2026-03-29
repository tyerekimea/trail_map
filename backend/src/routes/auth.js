const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/firestore');
const {
  DEFAULT_USAGE,
  normalizeUserRecord,
  sanitizeUser,
  hashPassword,
  comparePassword
} = require('../utils/user');
const { sendPasswordResetEmail } = require('../utils/email');
const logger = require('../utils/logger');
const { protect } = require('../middleware/auth');

const router = express.Router();
const REFRESH_TOKEN_COLLECTION = 'refreshTokens';

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

// Generate refresh token
const generateRefreshToken = (userId, tokenId = crypto.randomUUID()) => {
  const token = jwt.sign({ userId, tokenId, tokenType: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
  });
  return { token, tokenId };
};

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

const resolveRefreshTokenExpiry = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object' || !decoded.exp) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 7);
    return fallback;
  }
  return new Date(decoded.exp * 1000);
};

const persistRefreshToken = async ({ userId, tokenId, token, replacedBy = null }) => {
  const now = new Date();
  await db.collection(REFRESH_TOKEN_COLLECTION).doc(tokenId).set({
    userId,
    tokenHash: hashToken(token),
    expiresAt: resolveRefreshTokenExpiry(token),
    revoked: false,
    revokedAt: null,
    replacedBy,
    createdAt: now,
    updatedAt: now
  });
};

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

const findUserByEmail = async (email) => {
  const snapshot = await db
    .collection('users')
    .where('email', '==', String(email).toLowerCase().trim())
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return normalizeUserRecord(doc.id, doc.data());
};

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 */
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').trim().notEmpty(),
    body('phone').optional().trim().isLength({ min: 6, max: 24 })
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password, name, phone } = req.body;
      const normalizedEmail = String(email).toLowerCase().trim();

      const existingUser = await findUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered'
        });
      }

      const now = new Date();
      const hashedPassword = await hashPassword(password);
      const newUserPayload = {
        email: normalizedEmail,
        name: String(name).trim(),
        phone: phone ? String(phone).trim() : null,
        password: hashedPassword,
        authProvider: 'email',
        authId: null,
        deviceInfo: {},
        usage: DEFAULT_USAGE,
        lastLogin: now,
        isActive: true,
        role: 'user',
        createdAt: now,
        updatedAt: now
      };

      const userRef = await db.collection('users').add(newUserPayload);
      const savedUser = normalizeUserRecord(userRef.id, newUserPayload);

      const token = generateToken(savedUser._id);
      const { token: refreshToken, tokenId } = generateRefreshToken(savedUser._id);
      await persistRefreshToken({
        userId: savedUser._id,
        tokenId,
        token: refreshToken
      });

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: sanitizeUser(savedUser),
          token,
          refreshToken
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 */
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await findUserByEmail(email);

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const passwordMatch = await comparePassword(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const now = new Date();
      await db.collection('users').doc(user._id).update({
        lastLogin: now,
        updatedAt: now
      });

      const updatedUser = {
        ...user,
        lastLogin: now,
        updatedAt: now
      };

      const token = generateToken(user._id);
      const { token: refreshToken, tokenId } = generateRefreshToken(user._id);
      await persistRefreshToken({
        userId: user._id,
        tokenId,
        token: refreshToken
      });

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: sanitizeUser(updatedUser),
          token,
          refreshToken
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 */
router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token required'
        });
      }
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      if (
        !decoded ||
        typeof decoded !== 'object' ||
        decoded.tokenType !== 'refresh' ||
        !decoded.userId ||
        !decoded.tokenId
      ) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      const tokenRef = db.collection(REFRESH_TOKEN_COLLECTION).doc(decoded.tokenId);
      const tokenDoc = await tokenRef.get();
      if (!tokenDoc.exists) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      const tokenRecord = tokenDoc.data() || {};
      const tokenExpiresAt = tokenRecord.expiresAt?.toDate
        ? tokenRecord.expiresAt.toDate()
        : new Date(tokenRecord.expiresAt || 0);
      const tokenMatches = hashToken(refreshToken) === tokenRecord.tokenHash;
      if (
        tokenRecord.revoked === true ||
        !tokenMatches ||
        tokenRecord.userId !== decoded.userId ||
        Number.isNaN(tokenExpiresAt.getTime()) ||
        tokenExpiresAt <= new Date()
      ) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      const userDoc = await db.collection('users').doc(decoded.userId).get();
      if (!userDoc.exists || userDoc.data()?.isActive === false) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      const token = generateToken(decoded.userId);
      const nextRefresh = generateRefreshToken(decoded.userId);
      await db.runTransaction(async (transaction) => {
        transaction.set(
          tokenRef,
          {
            revoked: true,
            revokedAt: new Date(),
            replacedBy: nextRefresh.tokenId,
            updatedAt: new Date()
          },
          { merge: true }
        );

        const nextTokenRef = db
          .collection(REFRESH_TOKEN_COLLECTION)
          .doc(nextRefresh.tokenId);
        transaction.set(nextTokenRef, {
          userId: decoded.userId,
          tokenHash: hashToken(nextRefresh.token),
          expiresAt: resolveRefreshTokenExpiry(nextRefresh.token),
          revoked: false,
          revokedAt: null,
          replacedBy: null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      });

      return res.json({
        success: true,
        data: {
          token,
          refreshToken: nextRefresh.token
        }
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
  });

/**
 * @swagger
 * /api/auth/password-reset-request:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 */
router.post(
  '/password-reset-request',
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req, res) => {
    try {
      const { email } = req.body;
      // Don't reveal if user exists (security best practice)
      const user = await findUserByEmail(email);
      
      if (!user) {
        return res.status(200).json({
          success: true,
          message: 'If an account with this email exists, a password reset link has been sent'
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpires = new Date(Date.now() + (parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRE || '3600') * 1000));

      // Save hashed token to database
      await db.collection('users').doc(user._id).update({
        passwordResetToken: resetTokenHash,
        passwordResetExpires: resetTokenExpires,
        updatedAt: new Date()
      });

      // Create reset URL
      const resetUrl = `${process.env.PASSWORD_RESET_URL}?token=${resetToken}&email=${encodeURIComponent(email)}`;

      // Send email
      const emailSent = await sendPasswordResetEmail(email, resetToken, resetUrl);
      
      logger.info('Password reset requested', { 
        userId: user._id, 
        email, 
        emailSent 
      });

      return res.status(200).json({
        success: true,
        message: 'If an account with this email exists, a password reset link has been sent'
      });
    } catch (error) {
      logger.error('Password reset request failed', { error });
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/password-reset:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 */
router.post(
  '/password-reset',
  [
    body('email').isEmail().normalizeEmail(),
    body('token').notEmpty().trim().isLength({ min: 32 }),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  validate,
  async (req, res) => {
    try {
      const { email, token, newPassword } = req.body;
      
      const user = await findUserByEmail(email);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token or email'
        });
      }

      // Verify token
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const now = new Date();
      
      if (
        !user.passwordResetToken ||
        tokenHash !== user.passwordResetToken ||
        !user.passwordResetExpires ||
        user.passwordResetExpires <= now
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }

      // Update password
      const hashedPassword = await hashPassword(newPassword);
      await db.collection('users').doc(user._id).update({
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: now
      });

      logger.info('Password reset successful', { userId: user._id, email });

      return res.status(200).json({
        success: true,
        message: 'Password reset successful'
      });
    } catch (error) {
      logger.error('Password reset failed', { error });
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user (invalidate refresh tokens)
 *     tags: [Authentication]
 */
router.post('/logout', protect, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        if (decoded && decoded.tokenId) {
          await db.collection(REFRESH_TOKEN_COLLECTION).doc(decoded.tokenId).update({
            revoked: true,
            revokedAt: new Date(),
            updatedAt: new Date()
          });
        }
      } catch (error) {
        // Token might be invalid but logout should still succeed
        logger.warn('Failed to revoke refresh token during logout', { error: error.message });
      }
    }

    logger.info('User logged out', { userId: req.user._id });
    
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout failed', { error });
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
