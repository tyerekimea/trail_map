const crypto = require('crypto');
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db, mapSnapshot, toDate } = require('../config/firestore');
const { protect } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const MAX_SYNC_PULL_LIMIT = parseInt(process.env.PLACES_SYNC_PULL_MAX_LIMIT, 10) || 1000;
const DEFAULT_SYNC_PULL_LIMIT =
  parseInt(process.env.PLACES_SYNC_PULL_DEFAULT_LIMIT, 10) || 500;

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

const getUserPlaces = async (userId, { since, limit } = {}) => {
  let query = db.collection('places').where('userId', '==', userId);
  if (since) {
    query = query.where('updatedAt', '>', since);
  }
  if (limit) {
    query = query.limit(limit);
  }
  const snapshot = await query.get();
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
  const snapshot = await db
    .collection('places')
    .where('userId', '==', userId)
    .where('clientId', '==', clientId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return mapPlaceDoc(snapshot.docs[0]);
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

/**
 * Batch upsert places with transactional consistency
 * Ensures all-or-nothing semantics for atomic operations
 */
const batchUpsertPlaces = async (places) => {
  if (places.length === 0) {
    return [];
  }

  if (places.length === 1) {
    // Single place - no need for transaction
    return [await upsertPlace(places[0])];
  }

  // Multiple places - use transaction for atomicity
  const savedPlaces = [];

  await db.runTransaction(async (transaction) => {
    const now = new Date();

    for (const place of places) {
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
        // Update existing
        const docRef = db.collection('places').doc(place._id);
        transaction.set(docRef, payload, { merge: true });
        savedPlaces.push({ ...place, ...payload });
      } else {
        // Create new - need to generate ID within transaction
        const newDocRef = db.collection('places').doc();
        transaction.set(newDocRef, payload);
        savedPlaces.push({ _id: newDocRef.id, ...payload });
      }
    }
  });

  // Fetch the complete updated documents after transaction
  const completePlaces = [];
  for (const place of savedPlaces) {
    const doc = await db.collection('places').doc(place._id).get();
    if (doc.exists) {
      completePlaces.push(mapPlaceDoc(doc));
    }
  }

  return completePlaces;
};

const handlePushSync = async (req, res) => {
  try {
    const incomingPlaces = Array.isArray(req.body?.places) ? req.body.places : [];
    const now = new Date();
    const userId = req.user._id;

    const records = [];
    const conflicts = [];
    const errors = [];
    const placesToSave = [];

    logger.debug('Sync push started', { userId, incomingPlaceCount: incomingPlaces.length });

    // First pass: Validate and prepare places for batch save
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
        place = await findPlaceByIdForUser(payload.serverId, userId);
      }

      if (!place) {
        place = await findPlaceByClientId(userId, clientId);
      }

      if (!place) {
        place = {
          userId,
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
        logger.warn('Failed to apply place fields', { clientId, error: error.message });
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
      
      // Add to batch for transaction
      placesToSave.push(place);
    }

    // Second pass: Batch save all places atomically
    let savedPlaces = [];
    if (placesToSave.length > 0) {
      try {
        savedPlaces = await batchUpsertPlaces(placesToSave);
        savedPlaces.forEach(place => {
          records.push(mapPlaceToSyncRecord(place));
        });
      } catch (error) {
        logger.error('Batch upsert failed', { userId, placesToSave: placesToSave.length, error });
        return res.status(500).json({
          success: false,
          message: 'Failed to save places - transaction rolled back',
          error: error.message
        });
      }
    }

    logger.info('Sync push completed', { 
      userId, 
      applied: savedPlaces.length, 
      conflicts: conflicts.length, 
      errors: errors.length 
    });

    return res.json({
      success: true,
      data: {
        records,
        applied: savedPlaces.length,
        conflicts,
        errors,
        serverTime: now.toISOString()
      }
    });
  } catch (error) {
    logger.error('Sync push failed', { userId: req.user._id, error });
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Pull all server-side changes after a given timestamp
router.get(
  '/sync/pull',
  protect,
  [
    query('since')
      .optional()
      .isISO8601()
      .withMessage('since must be a valid ISO date'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: MAX_SYNC_PULL_LIMIT })
      .withMessage(`limit must be between 1 and ${MAX_SYNC_PULL_LIMIT}`)
  ],
  async (req, res) => {
    try {
      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: validationErrors.array()
        });
      }

      const userId = req.user._id;
      const since = parseDate(req.query.since);
      const limit = req.query.limit
        ? Math.min(Number(req.query.limit), MAX_SYNC_PULL_LIMIT)
        : DEFAULT_SYNC_PULL_LIMIT;
      const places = await getUserPlaces(userId, { since, limit });

      logger.debug('Sync pull requested', {
        userId,
        sinceDate: since?.toISOString(),
        placesCount: places.length,
        limit
      });

      const filteredPlaces = places.sort((a, b) => {
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
      logger.error('Sync pull failed', { userId: req.user._id, error });
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// Push local batched changes from the client
router.post(
  '/sync/push',
  protect,
  [
    body('places').isArray().withMessage('places must be an array'),
    body('places.*.clientId').notEmpty().trim(),
    body('places.*.name').optional().trim().isLength({ min: 1, max: 255 }),
    body('places.*.address').optional().trim().isLength({ min: 1, max: 500 }),
    body('places.*.latitude').optional().isFloat({ min: -90, max: 90 }),
    body('places.*.longitude').optional().isFloat({ min: -180, max: 180 }),
    body('places.*.category').optional().isIn(['Restaurant', 'Hotel', 'Airport', 'Hospital', 'Other']),
    body('places.*.isDeleted').optional().isBoolean()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Sync push validation failed', { userId: req.user._id, errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    return handlePushSync(req, res);
  }
);

// Backward compatibility with old /sync endpoint
router.post(
  '/sync',
  protect,
  [
    body('places').isArray().withMessage('places must be an array'),
    body('places.*.clientId').notEmpty().trim(),
    body('places.*.name').optional().trim().isLength({ min: 1, max: 255 }),
    body('places.*.address').optional().trim().isLength({ min: 1, max: 500 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Sync validation failed', { userId: req.user._id, errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    return handlePushSync(req, res);
  }
);

// Get all active (non-deleted) places for user
router.get(
  '/',
  protect,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: MAX_SYNC_PULL_LIMIT })
      .withMessage(`limit must be between 1 and ${MAX_SYNC_PULL_LIMIT}`)
  ],
  async (req, res) => {
  try {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: validationErrors.array()
      });
    }

    const userId = req.user._id;
    const limit = req.query.limit
      ? Math.min(Number(req.query.limit), MAX_SYNC_PULL_LIMIT)
      : DEFAULT_SYNC_PULL_LIMIT;
    const places = (await getUserPlaces(userId, { limit }))
      .filter((place) => !place.deletedAt)
      .sort((a, b) => {
        const aDate = a.createdAt || new Date(0);
        const bDate = b.createdAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });

    logger.debug('User places retrieved', { userId, count: places.length });

    res.json({
      success: true,
      count: places.length,
      data: places.map(mapPlaceToSyncRecord)
    });
  } catch (error) {
    logger.error('Failed to retrieve places', { userId: req.user._id, error });
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
  }
);

// Create saved place
router.post(
  '/',
  protect,
  [
    body('name').trim().notEmpty().isLength({ min: 1, max: 255 }).withMessage('Name is required (max 255 characters)'),
    body('address').trim().optional().isLength({ max: 500 }),
    body('latitude').notEmpty().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required (-90 to 90)'),
    body('longitude').notEmpty().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required (-180 to 180)'),
    body('category').optional().isIn(['Restaurant', 'Hotel', 'Airport', 'Hospital', 'Other']),
    body('notes').optional().trim().isLength({ max: 1000 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Create place validation failed', { userId: req.user._id, errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

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
      const userId = req.user._id;
      const place = {
        userId,
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
      logger.info('Place created', { userId, placeId: savedPlace._id });

      res.status(201).json({
        success: true,
        data: mapPlaceToSyncRecord(savedPlace)
      });
    } catch (error) {
      logger.error('Failed to create place', { userId: req.user._id, error });
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// Update saved place
router.put(
  '/:id',
  protect,
  [
    body('name').optional().trim().isLength({ min: 1, max: 255 }),
    body('address').optional().trim().isLength({ max: 500 }),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('category').optional().isIn(['Restaurant', 'Hotel', 'Airport', 'Hospital', 'Other']),
    body('notes').optional().trim().isLength({ max: 1000 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Update place validation failed', { userId: req.user._id, placeId: req.params.id, errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

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

      logger.info('Place updated', { userId: req.user._id, placeId: place._id });

      res.json({
        success: true,
        data: mapPlaceToSyncRecord(savedPlace)
      });
    } catch (error) {
      logger.error('Failed to update place', { userId: req.user._id, placeId: req.params.id, error });
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

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
    const savedPlace = await upsertPlace(place);

    logger.info('Place deleted', { userId: req.user._id, placeId: place._id });

    res.json({
      success: true,
      data: mapPlaceToSyncRecord(savedPlace)
    });
  } catch (error) {
    logger.error('Failed to delete place', { userId: req.user._id, placeId: req.params.id, error });
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
