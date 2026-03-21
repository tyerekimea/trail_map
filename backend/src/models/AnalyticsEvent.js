const { toDate } = require('../config/firestore');

const normalizeAnalyticsEvent = (id, rawData = {}) => ({
  _id: id,
  id,
  userId: rawData.userId || null,
  eventType: rawData.eventType,
  screen: rawData.screen || null,
  action: rawData.action || null,
  label: rawData.label || null,
  value: Number(rawData.value || 0),
  metadata: rawData.metadata || {},
  entityType: rawData.entityType || null,
  entityId: rawData.entityId || null,
  platform: rawData.platform || null,
  appVersion: rawData.appVersion || null,
  ipAddress: rawData.ipAddress || null,
  userAgent: rawData.userAgent || null,
  occurredAt: toDate(rawData.occurredAt),
  createdAt: toDate(rawData.createdAt),
  updatedAt: toDate(rawData.updatedAt)
});

module.exports = {
  collection: 'analyticsEvents',
  normalizeAnalyticsEvent
};
