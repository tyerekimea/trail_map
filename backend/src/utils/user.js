const bcrypt = require('bcryptjs');
const { toDate } = require('../config/firestore');

const DEFAULT_USAGE = {
  totalSearches: 0,
  totalNavigations: 0,
  totalDistance: 0
};

const isPremiumActive = (user) => {
  if (!user || !user.premiumExpiry) {
    return false;
  }

  const expiry = toDate(user.premiumExpiry);
  if (!expiry) {
    return false;
  }

  return expiry > new Date();
};

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  const output = { ...user };
  delete output.password;
  return output;
};

const normalizeUserRecord = (id, rawData = {}) => {
  return {
    _id: id,
    id,
    email: rawData.email,
    name: rawData.name,
    password: rawData.password || null,
    phone: rawData.phone || null,
    authProvider: rawData.authProvider || 'email',
    authId: rawData.authId || null,
    isPremium: Boolean(rawData.isPremium),
    premiumExpiry: toDate(rawData.premiumExpiry),
    premiumPlan: rawData.premiumPlan || null,
    premiumUpdatedAt: toDate(rawData.premiumUpdatedAt),
    deviceInfo: rawData.deviceInfo || {},
    usage: {
      ...DEFAULT_USAGE,
      ...(rawData.usage || {})
    },
    lastLogin: toDate(rawData.lastLogin),
    isActive: rawData.isActive !== false,
    role: rawData.role || 'user',
    createdAt: toDate(rawData.createdAt),
    updatedAt: toDate(rawData.updatedAt)
  };
};

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

const comparePassword = async (candidatePassword, hash) => {
  if (!hash) {
    return false;
  }

  return bcrypt.compare(candidatePassword, hash);
};

const getPremiumActivationFields = ({ expiryDate, planId = null }) => {
  return {
    isPremium: true,
    premiumExpiry: expiryDate,
    premiumPlan: planId,
    premiumUpdatedAt: new Date(),
    updatedAt: new Date()
  };
};

module.exports = {
  DEFAULT_USAGE,
  sanitizeUser,
  normalizeUserRecord,
  isPremiumActive,
  hashPassword,
  comparePassword,
  getPremiumActivationFields
};
