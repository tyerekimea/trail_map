const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { db, FieldValue, mapSnapshot, toDate } = require('../config/firestore');
const { protect, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  next();
};

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTags = (value) => {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
};

const buildLocation = (latitude, longitude) => {
  const lat = parseNumber(latitude);
  const lng = parseNumber(longitude);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lng
  };
};

const mapBusiness = (doc) => {
  const business = mapSnapshot(doc);

  return {
    ...business,
    createdAt: toDate(business.createdAt),
    updatedAt: toDate(business.updatedAt),
    analytics: {
      views: Number(business.analytics?.views || 0),
      clicks: Number(business.analytics?.clicks || 0)
    },
    tags: Array.isArray(business.tags) ? business.tags : []
  };
};

const countDocuments = async (queryRef) => {
  const snapshot = await queryRef.count().get();
  return Number(snapshot.data().count || 0);
};

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

router.get(
  '/search',
  [
    query('q').optional().trim().isLength({ min: 2, max: 120 }),
    query('category').optional().trim().isLength({ min: 2, max: 60 }),
    query('city').optional().trim().isLength({ min: 2, max: 80 }),
    query('state').optional().trim().isLength({ min: 2, max: 80 }),
    query('verified').optional().isBoolean(),
    query('latitude').optional().isFloat({ min: -90, max: 90 }),
    query('longitude').optional().isFloat({ min: -180, max: 180 }),
    query('radiusKm').optional().isFloat({ min: 0.1, max: 200 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('cursor').optional().trim().isLength({ min: 1, max: 128 })
  ],
  validate,
  async (req, res) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const cursor = req.query.cursor ? String(req.query.cursor).trim() : null;
      const skip = (page - 1) * limit;
      let queryRef = db.collection('businesses').where('isActive', '==', true);

      if (req.query.category) {
        queryRef = queryRef.where('category', '==', req.query.category);
      }

      if (req.query.verified !== undefined) {
        const verified = req.query.verified === 'true';
        queryRef = queryRef.where('isVerified', '==', verified);
      }

      if (req.query.city) {
        // Case-insensitive city matching is handled in-memory below.
      }

      if (req.query.state) {
        // Case-insensitive state matching is handled in-memory below.
      }

      const requiresInMemoryFiltering =
        Boolean(req.query.q || req.query.city || req.query.state) ||
        (req.query.latitude !== undefined && req.query.longitude !== undefined);

      if (!requiresInMemoryFiltering) {
        const total = await countDocuments(queryRef);
        let pagedQuery = queryRef
          .orderBy('createdAt', 'desc')
          .limit(limit + 1);

        if (cursor) {
          const cursorDoc = await db.collection('businesses').doc(cursor).get();
          if (!cursorDoc.exists) {
            return res.status(400).json({
              success: false,
              message: 'Invalid pagination cursor'
            });
          }
          pagedQuery = pagedQuery.startAfter(cursorDoc);
        }

        const pagedSnapshot = await pagedQuery.get();
        const docs = pagedSnapshot.docs;
        const hasMore = docs.length > limit;
        const pageDocs = hasMore ? docs.slice(0, limit) : docs;
        const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null;

        return res.json({
          success: true,
          data: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            businesses: pageDocs.map(mapBusiness),
            cursor,
            nextCursor
          }
        });
      }

      const fetchLimit =
        Math.min(
          parseInt(process.env.BUSINESS_SEARCH_FETCH_LIMIT, 10) ||
            Math.max(page * limit * 2, 100),
          parseInt(process.env.BUSINESS_SEARCH_FETCH_LIMIT_MAX, 10) || 250
        );
      if (skip >= fetchLimit) {
        return res.status(400).json({
          success: false,
          message: 'Requested page is outside allowed scan window. Narrow your filters.'
        });
      }
      const snapshot = await queryRef.limit(fetchLimit).get();
      let businesses = snapshot.docs.map(mapBusiness);

      if (req.query.city) {
        const city = req.query.city.toLowerCase();
        businesses = businesses.filter(
          (business) => String(business.city || '').toLowerCase() === city
        );
      }

      if (req.query.state) {
        const state = req.query.state.toLowerCase();
        businesses = businesses.filter(
          (business) => String(business.state || '').toLowerCase() === state
        );
      }

      if (req.query.q) {
        const needle = req.query.q.toLowerCase();
        businesses = businesses.filter((business) => {
          const searchable = [
            business.name,
            business.description,
            business.address,
            business.city,
            business.state,
            ...(Array.isArray(business.tags) ? business.tags : [])
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return searchable.includes(needle);
        });
      }

      if (req.query.latitude !== undefined && req.query.longitude !== undefined) {
        const userLat = Number(req.query.latitude);
        const userLng = Number(req.query.longitude);
        const radiusKm = Number(req.query.radiusKm || 10);

        businesses = businesses.filter((business) => {
          const lat = parseNumber(business.location?.latitude);
          const lng = parseNumber(business.location?.longitude);

          if (lat === null || lng === null) {
            return false;
          }

          const distance = haversineDistanceKm(userLat, userLng, lat, lng);
          return distance <= radiusKm;
        });
      }

      businesses.sort((a, b) => {
        const verifiedSort = Number(Boolean(b.isVerified)) - Number(Boolean(a.isVerified));
        if (verifiedSort !== 0) {
          return verifiedSort;
        }

        const viewsSort = Number(b.analytics?.views || 0) - Number(a.analytics?.views || 0);
        if (viewsSort !== 0) {
          return viewsSort;
        }

        const aDate = a.createdAt || new Date(0);
        const bDate = b.createdAt || new Date(0);
        return bDate.getTime() - aDate.getTime();
      });

      const total = businesses.length;
      const paginated = businesses.slice(skip, skip + limit);

      res.json({
        success: true,
        data: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          businesses: paginated,
          cursor: null,
          nextCursor: null
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Unable to search businesses',
        error: error.message
      });
    }
  }
);

router.get(
  '/:id',
  [param('id').trim().notEmpty().withMessage('Invalid business id')],
  validate,
  async (req, res) => {
    try {
      const businessDoc = await db.collection('businesses').doc(req.params.id).get();
      if (!businessDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const business = mapBusiness(businessDoc);
      if (business.isActive === false) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      return res.json({
        success: true,
        data: business
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to fetch business',
        error: error.message
      });
    }
  }
);

router.post(
  '/:id/view',
  [param('id').trim().notEmpty().withMessage('Invalid business id')],
  validate,
  async (req, res) => {
    try {
      const businessRef = db.collection('businesses').doc(req.params.id);
      const businessDoc = await businessRef.get();

      if (!businessDoc.exists || mapBusiness(businessDoc).isActive === false) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      await businessRef.update({
        'analytics.views': FieldValue.increment(1),
        updatedAt: new Date()
      });

      const updatedDoc = await businessRef.get();
      const updatedBusiness = mapBusiness(updatedDoc);

      return res.json({
        success: true,
        data: {
          id: updatedBusiness._id,
          views: updatedBusiness.analytics?.views || 0
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to track business view',
        error: error.message
      });
    }
  }
);

router.post(
  '/:id/click',
  [param('id').trim().notEmpty().withMessage('Invalid business id')],
  validate,
  async (req, res) => {
    try {
      const businessRef = db.collection('businesses').doc(req.params.id);
      const businessDoc = await businessRef.get();

      if (!businessDoc.exists || mapBusiness(businessDoc).isActive === false) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      await businessRef.update({
        'analytics.clicks': FieldValue.increment(1),
        updatedAt: new Date()
      });

      const updatedDoc = await businessRef.get();
      const updatedBusiness = mapBusiness(updatedDoc);

      return res.json({
        success: true,
        data: {
          id: updatedBusiness._id,
          clicks: updatedBusiness.analytics?.clicks || 0
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to track business click',
        error: error.message
      });
    }
  }
);

router.post(
  '/',
  protect,
  requireAdmin,
  [
    body('name').trim().notEmpty().isLength({ max: 120 }),
    body('category').trim().notEmpty().isLength({ max: 60 }),
    body('address').trim().notEmpty().isLength({ max: 240 }),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('city').optional().trim().isLength({ max: 80 }),
    body('state').optional().trim().isLength({ max: 80 }),
    body('country').optional().trim().isLength({ max: 80 }),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('email').optional().isEmail(),
    body('website').optional().isURL({ require_tld: false }),
    body('isVerified').optional().isBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      const location = buildLocation(req.body.latitude, req.body.longitude);
      if (!location) {
        return res.status(400).json({
          success: false,
          message: 'latitude and longitude are required'
        });
      }

      const now = new Date();
      const payload = {
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        address: req.body.address,
        city: req.body.city,
        state: req.body.state,
        country: req.body.country || 'Nigeria',
        location,
        phone: req.body.phone,
        email: req.body.email,
        website: req.body.website,
        tags: normalizeTags(req.body.tags),
        ownerId: req.body.ownerId || req.user._id,
        isActive: true,
        isVerified: Boolean(req.body.isVerified),
        analytics: {
          views: 0,
          clicks: 0
        },
        createdAt: now,
        updatedAt: now
      };

      const businessRef = await db.collection('businesses').add(payload);
      const businessDoc = await businessRef.get();

      return res.status(201).json({
        success: true,
        message: 'Business created successfully',
        data: mapBusiness(businessDoc)
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to create business',
        error: error.message
      });
    }
  }
);

router.put(
  '/:id',
  protect,
  requireAdmin,
  [
    param('id').trim().notEmpty().withMessage('Invalid business id'),
    body('name').optional().trim().notEmpty().isLength({ max: 120 }),
    body('category').optional().trim().notEmpty().isLength({ max: 60 }),
    body('address').optional().trim().notEmpty().isLength({ max: 240 }),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('city').optional().trim().isLength({ max: 80 }),
    body('state').optional().trim().isLength({ max: 80 }),
    body('country').optional().trim().isLength({ max: 80 }),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('email').optional().isEmail(),
    body('website').optional().isURL({ require_tld: false }),
    body('isActive').optional().isBoolean(),
    body('isVerified').optional().isBoolean()
  ],
  validate,
  async (req, res) => {
    try {
      const businessRef = db.collection('businesses').doc(req.params.id);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const existing = mapBusiness(businessDoc);
      const updates = {
        updatedAt: new Date()
      };

      const writableFields = [
        'name',
        'description',
        'category',
        'address',
        'city',
        'state',
        'country',
        'phone',
        'email',
        'website',
        'isActive',
        'isVerified'
      ];

      writableFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });

      if (req.body.tags !== undefined) {
        updates.tags = normalizeTags(req.body.tags);
      }

      if (req.body.latitude !== undefined || req.body.longitude !== undefined) {
        const nextLatitude =
          req.body.latitude !== undefined
            ? req.body.latitude
            : existing.location?.latitude;
        const nextLongitude =
          req.body.longitude !== undefined
            ? req.body.longitude
            : existing.location?.longitude;

        const location = buildLocation(nextLatitude, nextLongitude);
        if (!location) {
          return res.status(400).json({
            success: false,
            message: 'latitude and longitude are required'
          });
        }

        updates.location = location;
      }

      await businessRef.set(updates, { merge: true });
      const updatedDoc = await businessRef.get();

      return res.json({
        success: true,
        message: 'Business updated successfully',
        data: mapBusiness(updatedDoc)
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to update business',
        error: error.message
      });
    }
  }
);

router.delete(
  '/:id',
  protect,
  requireAdmin,
  [param('id').trim().notEmpty().withMessage('Invalid business id')],
  validate,
  async (req, res) => {
    try {
      const businessRef = db.collection('businesses').doc(req.params.id);
      const businessDoc = await businessRef.get();

      if (!businessDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      await businessRef.set(
        {
          isActive: false,
          updatedAt: new Date()
        },
        { merge: true }
      );

      return res.json({
        success: true,
        message: 'Business deactivated successfully',
        data: {
          id: req.params.id,
          isActive: false
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Unable to delete business',
        error: error.message
      });
    }
  }
);

module.exports = router;
