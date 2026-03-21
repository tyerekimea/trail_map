const { toDate } = require('../config/firestore');

const normalizeSavedPlace = (id, rawData = {}) => ({
  _id: id,
  id,
  userId: rawData.userId,
  clientId: rawData.clientId,
  name: rawData.name,
  address: rawData.address,
  location: {
    latitude: Number(rawData.location?.latitude),
    longitude: Number(rawData.location?.longitude)
  },
  category: rawData.category || 'Other',
  notes: rawData.notes || null,
  photos: Array.isArray(rawData.photos) ? rawData.photos : [],
  isPublic: Boolean(rawData.isPublic),
  syncedAt: toDate(rawData.syncedAt),
  deletedAt: toDate(rawData.deletedAt),
  createdAt: toDate(rawData.createdAt),
  updatedAt: toDate(rawData.updatedAt)
});

module.exports = {
  collection: 'places',
  normalizeSavedPlace
};
