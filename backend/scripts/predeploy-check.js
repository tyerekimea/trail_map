const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { evaluateEnv } = require('../src/config/env');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const errors = [];
const warnings = [];
const strictMode = String(process.env.PREDEPLOY_STRICT || '').toLowerCase() === 'true';

const assertTrueFlag = (key, description) => {
  if (String(process.env[key] || '').toLowerCase() !== 'true') {
    const message = `${key} must be true (${description})`;
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
};

const assertNumericMin = (key, min, description) => {
  const raw = process.env[key];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    const message = `${key} must be >= ${min} (${description})`;
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
};

const checkFirestoreRules = () => {
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  if (!fs.existsSync(rulesPath)) {
    errors.push('firestore.rules is missing');
    return;
  }
  const content = fs.readFileSync(rulesPath, 'utf8');
  if (!content.includes('allow read, write: if false;')) {
    warnings.push(
      'firestore.rules does not contain a default deny-all rule; verify direct client access is restricted.'
    );
  }
};

const checkRuntimeEnv = () => {
  const { missing, weak } = evaluateEnv({
    ...process.env,
    NODE_ENV: 'production'
  });
  if (missing.length > 0) {
    errors.push(`Missing required production env vars: ${missing.join(', ')}`);
  }
  if (weak.length > 0) {
    errors.push(`Weak or placeholder production env vars: ${weak.join(', ')}`);
  }
};

const checkSwaggerDocsConfig = () => {
  if (process.env.ENABLE_SWAGGER_DOCS !== 'true') {
    return;
  }
  const docsToken = String(process.env.SWAGGER_DOCS_TOKEN || '').trim();
  if (!docsToken) {
    errors.push('SWAGGER_DOCS_TOKEN is required when ENABLE_SWAGGER_DOCS=true');
  }
};

const run = () => {
  checkRuntimeEnv();
  checkFirestoreRules();
  checkSwaggerDocsConfig();

  assertTrueFlag('DEPLOYMENT_IAM_VALIDATED', 'confirm required IAM roles are configured');
  assertTrueFlag(
    'DEPLOYMENT_INDEXES_VALIDATED',
    'confirm Firestore indexes required by queried routes are created'
  );
  assertTrueFlag('FIRESTORE_BACKUP_ENABLED', 'confirm Firestore backups are enabled');
  assertNumericMin('CLOUD_RUN_MEMORY_MB', 2048, 'Cloud Run memory should be at least 2GB');

  if (warnings.length > 0) {
    console.warn(
      strictMode
        ? 'Warnings:'
        : 'Warnings (set PREDEPLOY_STRICT=true to fail on these checks):'
    );
    warnings.forEach((warning) => console.warn(`WARN: ${warning}`));
  }

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`ERROR: ${error}`));
    process.exit(1);
  }

  console.log('Pre-deployment checks passed.');
};

run();
