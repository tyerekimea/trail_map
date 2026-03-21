const jwt = require('jsonwebtoken');
const { db } = require('../config/firestore');
const {
  normalizeUserRecord,
  sanitizeUser,
  isPremiumActive
} = require('../utils/user');

// Verify JWT token
exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userDoc = await db.collection('users').doc(decoded.userId).get();
      if (!userDoc.exists) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      req.user = sanitizeUser(normalizeUserRecord(userDoc.id, userDoc.data()));
      if (!req.user || !req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token is invalid or expired'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Check if user is premium
exports.requirePremium = (req, res, next) => {
  if (!isPremiumActive(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Premium subscription required',
      upgradeUrl: '/api/subscriptions/plans'
    });
  }
  next();
};

// Check if user is admin
exports.requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};
