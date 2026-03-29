const {
  normalizeUserRecord,
  sanitizeUser,
  hashPassword,
  comparePassword
} = require('../utils/user');

module.exports = {
  collection: 'users',
  normalizeUserRecord,
  sanitizeUser,
  hashPassword,
  comparePassword
};
