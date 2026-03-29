jest.mock('../src/config/firestore', () => ({
  toDate: (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
}));

const {
  DEFAULT_USAGE,
  sanitizeUser,
  normalizeUserRecord,
  hashPassword,
  comparePassword,
} = require('../src/utils/user');

describe('user utils', () => {
  test('sanitizeUser removes password field', () => {
    const input = {
      _id: 'abc123',
      email: 'person@example.com',
      password: 'secret',
    };

    expect(sanitizeUser(input)).toEqual({
      _id: 'abc123',
      email: 'person@example.com',
    });
  });

  test('normalizeUserRecord applies defaults and date conversion', () => {
    const raw = {
      email: 'person@example.com',
      name: 'Person',
      usage: { totalSearches: 3 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const normalized = normalizeUserRecord('id-1', raw);

    expect(normalized._id).toBe('id-1');
    expect(normalized.id).toBe('id-1');
    expect(normalized.usage).toEqual({
      ...DEFAULT_USAGE,
      totalSearches: 3,
    });
    expect(normalized.createdAt).toBeInstanceOf(Date);
    expect(normalized.updatedAt).toBeInstanceOf(Date);
    expect(normalized.role).toBe('user');
    expect(normalized.isActive).toBe(true);
  });

  test('hashPassword and comparePassword work as expected', async () => {
    const plain = 'Password123!';
    const hash = await hashPassword(plain);

    expect(hash).toBeTruthy();
    expect(hash).not.toBe(plain);
    await expect(comparePassword(plain, hash)).resolves.toBe(true);
    await expect(comparePassword('wrong-pass', hash)).resolves.toBe(false);
    await expect(comparePassword(plain, null)).resolves.toBe(false);
  });
});
