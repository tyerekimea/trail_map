const bcrypt = require('bcryptjs');
const { toDate } = require('../config/firestore');

const DEFAULT_USAGE = {
  totalSearches: 0,
  totalNavigations: 0,
  totalDistance: 0
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

module.exports = {
  DEFAULT_USAGE,
  sanitizeUser,
  normalizeUserRecord,
  hashPassword,
  comparePassword
};
