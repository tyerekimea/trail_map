const REQUIRED_PROD_KEYS = [
  'NODE_ENV',
  'ALLOWED_ORIGINS',
  'API_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_MAPS_API_KEY'
];

const PLACEHOLDER_HINTS = ['your-', 'replace-with', 'example.com', 'change-this'];

const parseAllowedOrigins = (rawOrigins) =>
  String(rawOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const evaluateEnv = (env = process.env) => {
  const missing = [];
  const weak = [];

  REQUIRED_PROD_KEYS.forEach((key) => {
    const value = String(env[key] || '').trim();
    if (!value) {
      missing.push(key);
      return;
    }

    const normalizedValue = value.toLowerCase();
    if (PLACEHOLDER_HINTS.some((hint) => normalizedValue.includes(hint))) {
      weak.push(key);
    }
  });

  if (String(env.NODE_ENV || '').trim() !== 'production') {
    weak.push('NODE_ENV');
  }

  const origins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (
    origins.some((origin) => {
      const normalized = origin.toLowerCase();
      return (
        normalized === '*' ||
        normalized.includes('localhost') ||
        normalized.includes('127.0.0.1')
      );
    })
  ) {
    weak.push('ALLOWED_ORIGINS');
  }

  if (origins.length === 0) {
    missing.push('ALLOWED_ORIGINS');
  }

  return {
    missing: [...new Set(missing)],
    weak: [...new Set(weak)]
  };
};

const validateRuntimeEnv = ({ strictProduction = true } = {}) => {
  if (!strictProduction || process.env.NODE_ENV !== 'production') {
    return { missing: [], weak: [] };
  }

  const status = evaluateEnv(process.env);
  if (status.missing.length > 0 || status.weak.length > 0) {
    const reasons = [];
    if (status.missing.length > 0) {
      reasons.push(`missing: ${status.missing.join(', ')}`);
    }
    if (status.weak.length > 0) {
      reasons.push(`weak: ${status.weak.join(', ')}`);
    }
    throw new Error(`Production env validation failed (${reasons.join(' | ')})`);
  }

  return status;
};

module.exports = {
  evaluateEnv,
  validateRuntimeEnv,
  parseAllowedOrigins
};
