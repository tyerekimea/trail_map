const crypto = require('crypto');
const express = require('express');
const { db, mapSnapshot, toDate } = require('../config/firestore');
const { protect } = require('../middleware/auth');

const router = express.Router();

const parseDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapPlaceToSyncRecord = (place) => ({
  serverId: place._id,
  clientId: place.clientId,
  name: place.name,
  address: place.address,
  latitude: place.location?.latitude,
  longitude: place.location?.longitude,
  category: place.category,
  createdAt: place.createdAt ? new Date(place.createdAt).toISOString() : null,
  updatedAt: place.updatedAt ? new Date(place.updatedAt).toISOString() : null,
  deletedAt: place.deletedAt ? new Date(place.deletedAt).toISOString() : null,
  isDeleted: Boolean(place.deletedAt)
});

const mapPlaceDoc = (doc) => {
  const place = mapSnapshot(doc);
  return {
    ...place,
    createdAt: toDate(place.createdAt),
    updatedAt: toDate(place.updatedAt),
    deletedAt: toDate(place.deletedAt),
    syncedAt: toDate(place.syncedAt),
    location: {
      latitude: toNumber(place.location?.latitude),
      longitude: toNumber(place.location?.longitude)
    }
  };
};

const getUserPlaces = async (userId) => {
  const snapshot = await db.collection('places').where('userId', '==', userId).get();
  return snapshot.docs.map(mapPlaceDoc);
};

const findPlaceByIdForUser = async (placeId, userId) => {
  if (!placeId) {
    return null;
  }

  const placeDoc = await db.collection('places').doc(placeId).get();
  if (!placeDoc.exists) {
    return null;
  }

  const place = mapPlaceDoc(placeDoc);
  if (place.userId !== userId) {
    return null;
  }

  return place;
};

const findPlaceByClientId = async (userId, clientId) => {
  const userPlaces = await getUserPlaces(userId);
  return userPlaces.find((place) => place.clientId === clientId) || null;
};

const applyIncomingPlaceFields = (place, payload) => {
  const latitude =
    payload.latitude !== undefined
      ? toNumber(payload.latitude)
      : toNumber(place.location?.latitude);
  const longitude =
    payload.longitude !== undefined
      ? toNumber(payload.longitude)
      : toNumber(place.location?.longitude);

  if (latitude === null || longitude === null) {
    throw new Error('latitude and longitude are required');
  }

  if (payload.name !== undefined) {
    place.name = String(payload.name).trim();
  }
  if (payload.address !== undefined) {
    place.address = String(payload.address).trim();
  }
  if (payload.category !== undefined) {
    place.category = payload.category;
  }
  if (payload.notes !== undefined) {
    place.notes = payload.notes;
  }

  place.location = {
    latitude,
    longitude
  };
};

const upsertPlace = async (place) => {
  const now = new Date();
  const payload = {
    userId: place.userId,
    clientId: place.clientId,
    name: place.name,
    address: place.address,
    location: place.location,
    category: place.category || 'Other',
    notes: place.notes || null,
    photos: Array.isArray(place.photos) ? place.photos : [],
    isPublic: Boolean(place.isPublic),
    syncedAt: place.syncedAt || now,
    deletedAt: place.deletedAt || null,
    updatedAt: place.updatedAt || now,
    createdAt: place.createdAt || now
  };

  if (place._id) {
    await db.collection('places').doc(place._id).set(payload, { merge: true });
    const updatedDoc = await db.collection('places').doc(place._id).get();
    return mapPlaceDoc(updatedDoc);
  }

  const createdRef = await db.collection('places').add(payload);
  const createdDoc = await createdRef.get();
  return mapPlaceDoc(createdDoc);
};

const handlePushSync = async (req, res) => {
  try {
    const incomingPlaces = Array.isArray(req.body?.places) ? req.body.places : [];
    const now = new Date();

    const records = [];
    const conflicts = [];
    const errors = [];

    for (const payload of incomingPlaces) {
      if (!payload || typeof payload !== 'object') continue;

      const clientId = String(payload.clientId || '').trim();
      if (!clientId) {
        errors.push({ message: 'clientId is required' });
        continue;
      }

      const clientUpdatedAt = parseDate(payload.updatedAt) || now;
      let place = null;

      if (payload.serverId) {
        place = await findPlaceByIdForUser(payload.serverId, req.user._id);
      }

      if (!place) {
        place = await findPlaceByClientId(req.user._id, clientId);
      }

      if (!place) {
        place = {
          userId: req.user._id,
          clientId,
          name: String(payload.name || '').trim() || 'Untitled Place',
          address: String(payload.address || '').trim() || 'Unknown Address',
          category: payload.category || 'Other',
          createdAt: now,
          updatedAt: clientUpdatedAt
        };
      } else {
        const serverUpdatedAt = place.updatedAt || place.createdAt;
        if (serverUpdatedAt && clientUpdatedAt < serverUpdatedAt) {
          conflicts.push({
            clientId,
            serverId: place._id,
            serverUpdatedAt: serverUpdatedAt.toISOString()
          });
          records.push(mapPlaceToSyncRecord(place));
          continue;
        }
      }

      try {
        applyIncomingPlaceFields(place, payload);
      } catch (error) {
        errors.push({ clientId, message: error.message });
        continue;
      }

      if (payload.isDeleted === true || payload.deletedAt) {
        place.deletedAt = parseDate(payload.deletedAt) || now;
      } else if (payload.isDeleted === false) {
        place.deletedAt = null;
      }

      place.syncedAt = now;
      place.updatedAt = clientUpdatedAt;
      const savedPlace = await upsertPlace(place);
      records.push(mapPlaceToSyncRecord(savedPlace));
    }

    return res.json({
      success: true,
      data: {
        records,
        applied: records.length - conflicts.length,
        conflicts,
        errors,
        serverTime: now.toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Pull all server-side changes after a given timestamp
router.get('/sync/pull', protect, async (req, res) => {
  try {
    const since = parseDate(req.query.since);
    const allPlaces = await getUserPlaces(req.user._id);

    const filteredPlaces = allPlaces
      .filter((place) => {
        if (!since) return true;
        const updatedAt = place.updatedAt || place.createdAt;
        return updatedAt && updatedAt > since;
      })
      .sort((a, b) => {
        const aDate = a.updatedAt || a.createdAt || new Date(0);
        const bDate = b.updatedAt || b.createdAt || new Date(0);
        return aDate.getTime() - bDate.getTime();
      });

    res.json({
      success: true,
      data: {
        records: filteredPlaces.map(mapPlaceToSyncRecord),
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Push local batched changes from the client
router.post('/sync/push', protect, handlePushSync);

// Backward compatibility with old /sync endpoint
router.post('/sync', protect, handlePushSync);

// Get all active (non-deleted) places for user
router.get('/', protect, async (req, res) => {
  try {
    const places = (await getUserPlaces(req.user._id))
      .filter((place) => !place.deletedAt)
      .sort((a, b) => {
        const aDate = a.createdAt || new Date(0);
        const bDate = b.createdAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });

    res.json({
      success: true,
      count: places.length,
      data: places.map(mapPlaceToSyncRecord)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Create saved place
router.post('/', protect, async (req, res) => {
  try {
    const {
      clientId: rawClientId,
      name,
      address,
      latitude,
      longitude,
      category,
      notes
    } = req.body;

    const now = new Date();
    const clientId = String(rawClientId || '').trim() || `server-${crypto.randomUUID()}`;
    const place = {
      userId: req.user._id,
      clientId,
      name,
      address,
      location: {
        latitude: toNumber(latitude),
        longitude: toNumber(longitude)
      },
      category,
      notes,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };

    const savedPlace = await upsertPlace(place);

    res.status(201).json({
      success: true,
      data: mapPlaceToSyncRecord(savedPlace)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Update saved place
router.put('/:id', protect, async (req, res) => {
  try {
    const place = await findPlaceByIdForUser(req.params.id, req.user._id);

    if (!place) {
      return res.status(404).json({
        success: false,
        message: 'Place not found'
      });
    }

    applyIncomingPlaceFields(place, req.body);
    place.deletedAt = null;
    place.syncedAt = new Date();
    place.updatedAt = new Date();
    const savedPlace = await upsertPlace(place);

    res.json({
      success: true,
      data: mapPlaceToSyncRecord(savedPlace)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Soft delete saved place
router.delete('/:id', protect, async (req, res) => {
  try {
    const place = await findPlaceByIdForUser(req.params.id, req.user._id);

    if (!place) {
      return res.status(404).json({
        success: false,
        message: 'Place not found'
      });
    }

    place.deletedAt = new Date();
    place.syncedAt = new Date();
    place.updatedAt = new Date();
    const savedPlace = await upsertPlace(place);

    res.json({
      success: true,
      message: 'Place deleted successfully',
      data: mapPlaceToSyncRecord(savedPlace)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
