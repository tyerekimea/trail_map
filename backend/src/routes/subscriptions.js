const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { db, mapSnapshot, toDate } = require('../config/firestore');
const { protect } = require('../middleware/auth');
const {
  normalizeUserRecord,
  sanitizeUser,
  isPremiumActive,
  getPremiumActivationFields
} = require('../utils/user');

const router = express.Router();

const SUBSCRIPTION_PLANS = {
  monthly: {
    id: 'monthly',
    name: 'Monthly Premium',
    price: Number(process.env.PREMIUM_MONTHLY_PRICE || 2000),
    currency: 'NGN',
    duration: '1 month',
    durationDays: 30
  },
  yearly: {
    id: 'yearly',
    name: 'Yearly Premium',
    price: Number(process.env.PREMIUM_YEARLY_PRICE || 20000),
    currency: 'NGN',
    duration: '1 year',
    durationDays: 365,
    discount: '17%'
  }
};

const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  timeout: 15000
});

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

const ensurePaystackConfigured = () => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    const error = new Error('PAYSTACK_SECRET_KEY is not configured');
    error.statusCode = 500;
    throw error;
  }
};

const paystackRequest = async ({ method, url, data }) => {
  ensurePaystackConfigured();

  try {
    const response = await paystackClient({
      method,
      url,
      data,
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });

    return response.data;
  } catch (error) {
    const message =
      error.response?.data?.message ||
      error.message ||
      'Unable to complete payment request';
    const statusCode = error.response?.status || 502;

    const wrapped = new Error(message);
    wrapped.statusCode = statusCode >= 500 ? 502 : statusCode;
    throw wrapped;
  }
};

const buildReference = (userId) => {
  const random = crypto.randomBytes(6).toString('hex');
  return `sub_${userId}_${Date.now()}_${random}`;
};

const parsePaystackPayload = (body) => {
  if (Buffer.isBuffer(body)) {
    const text = body.toString('utf8') || '{}';
    return JSON.parse(text);
  }

  if (!body || typeof body !== 'object') {
    return {};
  }

  return body;
};

const getSignatureSecret = () => {
  return process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
};

const verifyWebhookSignature = (req) => {
  const secret = getSignatureSecret();
  if (!secret) {
    return false;
  }

  const signature = req.headers['x-paystack-signature'];
  if (!signature) {
    return false;
  }

  const payloadBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body || {}));

  const hash = crypto
    .createHmac('sha512', secret)
    .update(payloadBuffer)
    .digest('hex');

  return hash === signature;
};

const mapSubscription = (doc) => {
  const item = mapSnapshot(doc);
  return {
    ...item,
    paidAt: toDate(item.paidAt),
    startsAt: toDate(item.startsAt),
    endsAt: toDate(item.endsAt),
    verifiedAt: toDate(item.verifiedAt),
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt)
  };
};

const getSubscriptionByReference = async (reference) => {
  const snapshot = await db
    .collection('subscriptions')
    .where('reference', '==', reference)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return mapSubscription(snapshot.docs[0]);
};

const getUserById = async (userId) => {
  if (!userId) {
    return null;
  }

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return null;
  }

  return normalizeUserRecord(userDoc.id, userDoc.data());
};

const upsertSubscription = async (subscription) => {
  const now = new Date();
  const payload = {
    userId: subscription.userId,
    planId: subscription.planId,
    amount: subscription.amount,
    currency: subscription.currency || 'NGN',
    reference: subscription.reference,
    status: subscription.status || 'pending',
    authorizationUrl: subscription.authorizationUrl || null,
    accessCode: subscription.accessCode || null,
    paystackTransactionId: subscription.paystackTransactionId || null,
    paystackCustomerCode: subscription.paystackCustomerCode || null,
    gatewayResponse: subscription.gatewayResponse || null,
    metadata: subscription.metadata || {},
    paidAt: subscription.paidAt || null,
    startsAt: subscription.startsAt || null,
    endsAt: subscription.endsAt || null,
    verifiedAt: subscription.verifiedAt || null,
    failedReason: subscription.failedReason || null,
    createdAt: subscription.createdAt || now,
    updatedAt: subscription.updatedAt || now
  };

  if (subscription._id) {
    await db.collection('subscriptions').doc(subscription._id).set(payload, { merge: true });
    const updatedDoc = await db.collection('subscriptions').doc(subscription._id).get();
    return mapSubscription(updatedDoc);
  }

  const createdRef = await db.collection('subscriptions').add(payload);
  const createdDoc = await createdRef.get();
  return mapSubscription(createdDoc);
};

const computePremiumWindow = (user, paidAt, durationDays) => {
  const now = new Date();
  const paidDate = paidAt || now;
  const activeExpiry = toDate(user.premiumExpiry);
  const baseDate = activeExpiry && activeExpiry > now ? activeExpiry : paidDate;

  const startsAt = new Date(baseDate);
  const endsAt = new Date(startsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + durationDays);

  return { startsAt, endsAt };
};

const findOrCreateSubscription = async (reference, paystackData) => {
  let subscription = await getSubscriptionByReference(reference);
  if (subscription) {
    return subscription;
  }

  const metadata = paystackData.metadata || {};
  const userId = metadata.userId;
  const planId = metadata.planId;

  if (!userId || !SUBSCRIPTION_PLANS[planId]) {
    return null;
  }

  subscription = await upsertSubscription({
    userId,
    planId,
    amount: SUBSCRIPTION_PLANS[planId].price,
    currency: SUBSCRIPTION_PLANS[planId].currency,
    reference,
    status: 'pending',
    metadata,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return subscription;
};

const applyVerifiedPayment = async ({ reference, paystackPayload }) => {
  const verifiedResponse = paystackPayload
    ? { status: true, data: paystackPayload }
    : await paystackRequest({
        method: 'GET',
        url: `/transaction/verify/${encodeURIComponent(reference)}`
      });

  if (!verifiedResponse.status || !verifiedResponse.data) {
    const error = new Error('Unable to verify payment');
    error.statusCode = 502;
    throw error;
  }

  const paymentData = verifiedResponse.data;
  let subscription = await findOrCreateSubscription(reference, paymentData);

  if (!subscription) {
    const error = new Error('Subscription record not found for payment reference');
    error.statusCode = 404;
    throw error;
  }

  const user = await getUserById(subscription.userId);
  if (!user) {
    subscription = await upsertSubscription({
      ...subscription,
      status: 'failed',
      failedReason: 'User not found',
      gatewayResponse: paymentData,
      verifiedAt: new Date(),
      updatedAt: new Date()
    });

    const error = new Error('User not found for subscription');
    error.statusCode = 404;
    throw error;
  }

  const plan = SUBSCRIPTION_PLANS[subscription.planId];
  if (!plan) {
    const error = new Error('Subscription plan is invalid');
    error.statusCode = 400;
    throw error;
  }

  const normalizedStatus = String(paymentData.status || '').toLowerCase();
  if (normalizedStatus !== 'success') {
    subscription = await upsertSubscription({
      ...subscription,
      status: normalizedStatus === 'abandoned' ? 'abandoned' : 'failed',
      failedReason: paymentData.gateway_response || 'Payment not successful',
      gatewayResponse: paymentData,
      verifiedAt: new Date(),
      updatedAt: new Date()
    });

    return {
      success: false,
      subscription,
      user,
      message: 'Payment is not successful'
    };
  }

  const paidAmount = Number(paymentData.amount || 0) / 100;
  if (paidAmount < plan.price) {
    subscription = await upsertSubscription({
      ...subscription,
      status: 'failed',
      failedReason: 'Amount paid is lower than plan amount',
      gatewayResponse: paymentData,
      verifiedAt: new Date(),
      updatedAt: new Date()
    });

    const error = new Error('Amount mismatch while verifying payment');
    error.statusCode = 400;
    throw error;
  }

  const paidAt = paymentData.paid_at ? new Date(paymentData.paid_at) : new Date();
  const { startsAt, endsAt } = computePremiumWindow(user, paidAt, plan.durationDays);

  subscription = await upsertSubscription({
    ...subscription,
    status: 'success',
    paidAt,
    startsAt,
    endsAt,
    verifiedAt: new Date(),
    gatewayResponse: paymentData,
    paystackTransactionId: String(paymentData.id || ''),
    paystackCustomerCode: paymentData.customer?.customer_code || '',
    updatedAt: new Date()
  });

  const userUpdates = getPremiumActivationFields({
    expiryDate: endsAt,
    planId: subscription.planId
  });

  await db.collection('users').doc(user._id).set(userUpdates, { merge: true });
  const updatedUser = {
    ...user,
    ...userUpdates
  };

  return {
    success: true,
    subscription,
    user: sanitizeUser(updatedUser)
  };
};

router.get('/plans', (req, res) => {
  res.json({
    success: true,
    data: Object.values(SUBSCRIPTION_PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      duration: plan.duration,
      ...(plan.discount ? { discount: plan.discount } : {})
    }))
  });
});

router.get('/status', protect, async (req, res) => {
  const snapshot = await db
    .collection('subscriptions')
    .where('userId', '==', req.user._id)
    .get();

  const latestSubscription = snapshot.docs
    .map(mapSubscription)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;

  res.json({
    success: true,
    data: {
      isPremium: isPremiumActive(req.user),
      premiumPlan: req.user.premiumPlan || null,
      premiumExpiry: req.user.premiumExpiry || null,
      latestSubscription
    }
  });
});

router.post(
  '/subscribe',
  protect,
  [
    body('planId')
      .trim()
      .isIn(Object.keys(SUBSCRIPTION_PLANS))
      .withMessage('planId must be monthly or yearly'),
    body('callbackUrl')
      .optional()
      .isURL({ require_tld: false })
      .withMessage('callbackUrl must be a valid URL')
  ],
  validate,
  async (req, res) => {
    try {
      const { planId, callbackUrl } = req.body;
      const plan = SUBSCRIPTION_PLANS[planId];
      const reference = buildReference(req.user._id);

      const initializePayload = {
        email: req.user.email,
        amount: Math.round(plan.price * 100),
        currency: plan.currency,
        reference,
        callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL,
        metadata: {
          userId: req.user._id,
          planId,
          app: 'trail_map'
        }
      };

      const initializeResponse = await paystackRequest({
        method: 'POST',
        url: '/transaction/initialize',
        data: initializePayload
      });

      if (!initializeResponse.status || !initializeResponse.data) {
        return res.status(502).json({
          success: false,
          message: 'Failed to initialize payment'
        });
      }

      const paymentData = initializeResponse.data;
      const subscription = await upsertSubscription({
        userId: req.user._id,
        planId,
        amount: plan.price,
        currency: plan.currency,
        reference,
        status: 'pending',
        authorizationUrl: paymentData.authorization_url,
        accessCode: paymentData.access_code,
        metadata: initializePayload.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return res.status(201).json({
        success: true,
        message: 'Payment initialized',
        data: {
          subscriptionId: subscription._id,
          reference,
          authorizationUrl: paymentData.authorization_url,
          accessCode: paymentData.access_code,
          amount: plan.price,
          currency: plan.currency,
          planId
        }
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Unable to initialize subscription payment'
      });
    }
  }
);

router.post(
  '/verify',
  protect,
  [body('reference').trim().notEmpty().withMessage('reference is required')],
  validate,
  async (req, res) => {
    try {
      const { reference } = req.body;
      const subscription = await getSubscriptionByReference(reference);
      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription transaction not found'
        });
      }

      if (subscription.userId !== req.user._id) {
        return res.status(403).json({
          success: false,
          message: 'You are not allowed to verify this transaction'
        });
      }

      const result = await applyVerifiedPayment({ reference });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
          data: {
            isPremium: isPremiumActive(result.user),
            premiumExpiry: result.user.premiumExpiry || null,
            subscription: result.subscription
          }
        });
      }

      return res.json({
        success: true,
        message: 'Subscription verified successfully',
        data: {
          isPremium: isPremiumActive(result.user),
          premiumPlan: result.user.premiumPlan,
          premiumExpiry: result.user.premiumExpiry,
          subscription: result.subscription
        }
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Unable to verify transaction'
      });
    }
  }
);

router.post('/webhook', async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    const payload = parsePaystackPayload(req.body);
    const event = payload.event;
    const paymentData = payload.data || {};

    if (event !== 'charge.success') {
      return res.status(200).json({
        success: true,
        message: 'Event ignored'
      });
    }

    const reference = paymentData.reference;
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Missing transaction reference'
      });
    }

    await applyVerifiedPayment({
      reference,
      paystackPayload: paymentData
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Webhook processing failed'
    });
  }
});

module.exports = router;
