const REQUIRED_KEYS = [
  'NODE_ENV',
  'ALLOWED_ORIGINS',
  'API_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_MAPS_API_KEY',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PUBLIC_KEY',
  'PAYSTACK_WEBHOOK_SECRET'
];

const PLACEHOLDER_HINTS = [
  'your-',
  'replace-with',
  'sk_test_',
  'pk_test_',
  'example.com',
  'change-this'
];

const missing = [];
const weak = [];

REQUIRED_KEYS.forEach((key) => {
  const raw = process.env[key];
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (!value) {
    missing.push(key);
    return;
  }

  const normalized = value.toLowerCase();
  if (PLACEHOLDER_HINTS.some((hint) => normalized.includes(hint))) {
    weak.push(key);
  }
});

if ((process.env.NODE_ENV || '').trim() !== 'production') {
  weak.push('NODE_ENV');
}

if (missing.length > 0 || weak.length > 0) {
  if (missing.length > 0) {
    console.error('Missing required env vars:', missing.join(', '));
  }

  if (weak.length > 0) {
    console.error(
      'Suspicious placeholder/non-production env vars:',
      [...new Set(weak)].join(', ')
    );
  }

  process.exit(1);
}

console.log('Production environment validation passed.');
