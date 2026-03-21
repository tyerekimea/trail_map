const { toDate } = require('../config/firestore');

const normalizeSubscription = (id, rawData = {}) => ({
  _id: id,
  id,
  userId: rawData.userId,
  planId: rawData.planId,
  amount: Number(rawData.amount || 0),
  currency: rawData.currency || 'NGN',
  reference: rawData.reference,
  status: rawData.status || 'pending',
  authorizationUrl: rawData.authorizationUrl || null,
  accessCode: rawData.accessCode || null,
  paystackTransactionId: rawData.paystackTransactionId || null,
  paystackCustomerCode: rawData.paystackCustomerCode || null,
  gatewayResponse: rawData.gatewayResponse || null,
  metadata: rawData.metadata || {},
  paidAt: toDate(rawData.paidAt),
  startsAt: toDate(rawData.startsAt),
  endsAt: toDate(rawData.endsAt),
  verifiedAt: toDate(rawData.verifiedAt),
  failedReason: rawData.failedReason || null,
  createdAt: toDate(rawData.createdAt),
  updatedAt: toDate(rawData.updatedAt)
});

module.exports = {
  collection: 'subscriptions',
  normalizeSubscription
};
