const { db } = require('../config/firestore');
const logger = require('./logger');

const writeAuditLog = async ({
  action,
  actorId = null,
  targetId = null,
  status = 'success',
  requestId = null,
  ip = null,
  userAgent = null,
  metadata = {}
}) => {
  if (!action) {
    return;
  }

  const payload = {
    action,
    actorId,
    targetId,
    status,
    requestId,
    ip,
    userAgent,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    createdAt: new Date()
  };

  try {
    const collectionRef = db.collection('auditLogs');
    if (!collectionRef || typeof collectionRef.add !== 'function') {
      return;
    }
    await collectionRef.add(payload);
  } catch (error) {
    logger.warn('Failed to persist audit log', {
      action,
      actorId,
      status,
      error
    });
  }
};

module.exports = {
  writeAuditLog
};
