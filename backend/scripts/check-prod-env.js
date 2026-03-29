const path = require('path');
const dotenv = require('dotenv');
const { evaluateEnv } = require('../src/config/env');

// Load local env files for validation while keeping runtime-provided env vars first.
// backend/.env must take precedence over root .env when both define the same key.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { missing, weak } = evaluateEnv(process.env);

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
