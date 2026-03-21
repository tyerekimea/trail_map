const {
  normalizeUserRecord,
  sanitizeUser,
  isPremiumActive,
  hashPassword,
  comparePassword,
  getPremiumActivationFields
} = require('../utils/user');

module.exports = {
  collection: 'users',
  normalizeUserRecord,
  sanitizeUser,
  isPremiumActive,
  hashPassword,
  comparePassword,
  getPremiumActivationFields
};
