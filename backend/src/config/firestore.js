const admin = require('firebase-admin');

const normalizePrivateKey = (value) => {
  if (!value || typeof value !== 'string') {
    return value;
  }

  return value.replace(/\\n/g, '\n');
};

const resolveServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.private_key) {
        parsed.private_key = normalizePrivateKey(parsed.private_key);
      }
      return parsed;
    }
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
    };
  }

  return null;
};

const initializeFirebase = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccount = resolveServiceAccount();

  if (serviceAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) {
    return admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  }

  throw new Error(
    'Firestore credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
  );
};

let firestoreDb = null;
let firestoreSettingsApplied = false;

const initFirestore = () => {
  if (firestoreDb) {
    return firestoreDb;
  }

  initializeFirebase();
  firestoreDb = admin.firestore();

  if (!firestoreSettingsApplied) {
    firestoreDb.settings({ ignoreUndefinedProperties: true });
    firestoreSettingsApplied = true;
  }

  return firestoreDb;
};

const db = initFirestore();

const { Timestamp, FieldValue } = admin.firestore;

const convertFromFirestore = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (Array.isArray(value)) {
    return value.map(convertFromFirestore);
  }

  if (typeof value === 'object') {
    const output = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      output[key] = convertFromFirestore(nestedValue);
    });
    return output;
  }

  return value;
};

const mapSnapshot = (doc) => ({
  _id: doc.id,
  id: doc.id,
  ...convertFromFirestore(doc.data() || {})
});

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

module.exports = {
  admin,
  db,
  FieldValue,
  Timestamp,
  initFirestore,
  mapSnapshot,
  toDate,
  convertFromFirestore
};
