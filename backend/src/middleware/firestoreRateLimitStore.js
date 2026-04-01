const crypto = require('crypto');
const { db } = require('../config/firestore');
const logger = require('../utils/logger');

class FirestoreRateLimitStore {
  constructor({ scope = 'api', collectionName = 'rateLimitBuckets', windowMs = 15 * 60 * 1000 } = {}) {
    this.scope = scope;
    this.collectionName = collectionName;
    this.windowMs = windowMs;
    this.localKeys = false;
  }

  init(options) {
    if (options?.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  _bucketStart(now = Date.now()) {
    return Math.floor(now / this.windowMs) * this.windowMs;
  }

  _hashKey(key) {
    return crypto.createHash('sha256').update(String(key)).digest('hex');
  }

  _docRef(key, bucketStart) {
    const hashedKey = this._hashKey(key);
    const docId = `${this.scope}:${bucketStart}:${hashedKey}`;
    return db.collection(this.collectionName).doc(docId);
  }

  async increment(key) {
    const now = Date.now();
    const bucketStart = this._bucketStart(now);
    const resetTime = new Date(bucketStart + this.windowMs);
    const expiresAt = new Date(bucketStart + (this.windowMs * 2));
    const docRef = this._docRef(key, bucketStart);

    const totalHits = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      const previousHits = snapshot.exists ? Number(snapshot.data()?.totalHits || 0) : 0;
      const nextHits = previousHits + 1;

      transaction.set(
        docRef,
        {
          scope: this.scope,
          keyHash: this._hashKey(key),
          totalHits: nextHits,
          resetTime,
          expiresAt,
          updatedAt: new Date()
        },
        { merge: true }
      );

      return nextHits;
    });

    return {
      totalHits,
      resetTime
    };
  }

  async decrement(key) {
    const bucketStart = this._bucketStart();
    const docRef = this._docRef(key, bucketStart);

    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          return;
        }

        const currentHits = Number(snapshot.data()?.totalHits || 0);
        const nextHits = Math.max(0, currentHits - 1);
        transaction.set(
          docRef,
          {
            totalHits: nextHits,
            updatedAt: new Date()
          },
          { merge: true }
        );
      });
    } catch (error) {
      logger.warn('Failed to decrement Firestore rate-limit counter', {
        scope: this.scope,
        error
      });
    }
  }

  async resetKey(key) {
    const bucketStart = this._bucketStart();
    const docRef = this._docRef(key, bucketStart);
    await docRef.delete().catch((error) => {
      logger.warn('Failed to reset Firestore rate-limit key', {
        scope: this.scope,
        error
      });
    });
  }

  async get(key) {
    const bucketStart = this._bucketStart();
    const docRef = this._docRef(key, bucketStart);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return undefined;
    }

    const data = snapshot.data() || {};
    return {
      totalHits: Number(data.totalHits || 0),
      resetTime: data.resetTime?.toDate ? data.resetTime.toDate() : data.resetTime
    };
  }

  async resetAll() {
    logger.warn('resetAll is not implemented for FirestoreRateLimitStore');
  }

  shutdown() {}
}

module.exports = {
  FirestoreRateLimitStore
};
