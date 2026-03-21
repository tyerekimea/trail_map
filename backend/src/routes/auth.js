const express = require('express');
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

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

// Generate refresh token
const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
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
        isPremium: false,
        premiumExpiry: null,
        premiumPlan: null,
        premiumUpdatedAt: null,
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
      const refreshToken = generateRefreshToken(savedUser._id);

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
      const refreshToken = generateRefreshToken(user._id);

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
    const token = generateToken(decoded.userId);

    return res.json({
      success: true,
      data: { token }
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
});

module.exports = router;
