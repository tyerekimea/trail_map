const { toDate } = require('../config/firestore');

const normalizeBusinessListing = (id, rawData = {}) => ({
  _id: id,
  id,
  name: rawData.name,
  description: rawData.description || null,
  category: rawData.category || 'general',
  address: rawData.address,
  city: rawData.city || null,
  state: rawData.state || null,
  country: rawData.country || 'Nigeria',
  location: {
    latitude: Number(rawData.location?.latitude),
    longitude: Number(rawData.location?.longitude)
  },
  phone: rawData.phone || null,
  email: rawData.email || null,
  website: rawData.website || null,
  tags: Array.isArray(rawData.tags) ? rawData.tags : [],
  ownerId: rawData.ownerId || null,
  isActive: rawData.isActive !== false,
  isVerified: Boolean(rawData.isVerified),
  analytics: {
    views: Number(rawData.analytics?.views || 0),
    clicks: Number(rawData.analytics?.clicks || 0)
  },
  createdAt: toDate(rawData.createdAt),
  updatedAt: toDate(rawData.updatedAt)
});

module.exports = {
  collection: 'businesses',
  normalizeBusinessListing
};
