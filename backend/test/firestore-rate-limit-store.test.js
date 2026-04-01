const mockRecords = new Map();

const mockMakeSnapshot = (docRef) => {
  const value = mockRecords.get(docRef.id);
  return {
    exists: value !== undefined,
    data: () => value
  };
};

jest.mock('../src/config/firestore', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn((id) => ({
        id,
        get: jest.fn(async () => mockMakeSnapshot({ id })),
        delete: jest.fn(async () => {
          mockRecords.delete(id);
        })
      }))
    })),
    runTransaction: jest.fn(async (handler) => {
      const transaction = {
        get: jest.fn(async (docRef) => mockMakeSnapshot(docRef)),
        set: jest.fn((docRef, data, options = {}) => {
          const previous = mockRecords.get(docRef.id) || {};
          const next = options.merge ? { ...previous, ...data } : data;
          mockRecords.set(docRef.id, next);
        })
      };

      return handler(transaction);
    })
  }
}));

describe('FirestoreRateLimitStore', () => {
  let FirestoreRateLimitStore;

  beforeEach(() => {
    mockRecords.clear();
    jest.resetModules();
    ({ FirestoreRateLimitStore } = require('../src/middleware/firestoreRateLimitStore'));
  });

  test('increment and get track hits in active window', async () => {
    const store = new FirestoreRateLimitStore({
      scope: 'api',
      windowMs: 60 * 1000
    });

    const first = await store.increment('127.0.0.1');
    const second = await store.increment('127.0.0.1');
    const current = await store.get('127.0.0.1');

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(current.totalHits).toBe(2);
    expect(current.resetTime).toBeInstanceOf(Date);
  });

  test('decrement and resetKey reduce counters safely', async () => {
    const store = new FirestoreRateLimitStore({
      scope: 'auth',
      windowMs: 60 * 1000
    });

    await store.increment('user-key');
    await store.increment('user-key');
    await store.decrement('user-key');
    const afterDecrement = await store.get('user-key');
    expect(afterDecrement.totalHits).toBe(1);

    await store.resetKey('user-key');
    const afterReset = await store.get('user-key');
    expect(afterReset).toBeUndefined();
  });
});
