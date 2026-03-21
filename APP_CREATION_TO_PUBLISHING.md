# Trail App: Creation to Testing to Publishing

This guide is the practical end-to-end workflow for this codebase (Flutter app + Node/Express backend + Firestore).

## 1. Architecture and Environment Separation

- Mobile app: Flutter (`trail_map/`)
- Backend API: Node.js/Express (`trail_map/backend/`)
- Database: Firestore (server-side access through Firebase Admin SDK)

Use env files this way:

- `trail_map/.env`: client-safe values only
  - `BACKEND_BASE_URL`
  - `GOOGLE_MAPS_API_KEY` (restricted)
- `trail_map/backend/.env`: server secrets
  - Firestore service account values
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`
  - Paystack secret keys
  - Admin and SMTP credentials

Never put backend secrets in the app `.env` because that file is bundled into the mobile app.

## 2. Initial Project Setup

### 2.1 Flutter app

```bash
cd trail_map
flutter pub get
```

### 2.2 Backend

```bash
cd trail_map/backend
npm install
```

## 3. Firebase and Firestore Setup

1. Create a Firebase project.
2. Enable Firestore.
3. In Firebase Console:
   - Project settings -> Service accounts -> Generate new private key
4. Put these values in `trail_map/backend/.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
5. Ensure private key keeps escaped newlines:
   - `FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`

Alternative:

- Use `FIREBASE_SERVICE_ACCOUNT_JSON` in `backend/.env`.

## 4. Configure App and API Keys

1. Keep app env minimal in `trail_map/.env`:

```env
BACKEND_BASE_URL=http://10.0.2.2:3000
GOOGLE_MAPS_API_KEY=your_restricted_key
```

2. Ensure Android Firebase file is in place:
   - `trail_map/android/app/google-services.json`
3. Ensure Android package ID matches configured services:
   - `com.example.trail_app` (change to your production package before release)

## 5. Configure Backend Secrets

Use `trail_map/backend/.env` (example keys):

```env
NODE_ENV=development
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

JWT_SECRET=generate_a_long_random_value
JWT_REFRESH_SECRET=generate_another_long_random_value

PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_WEBHOOK_SECRET=...
```

Generate JWT secrets:

```bash
openssl rand -base64 64
```

## 6. Run Locally

Start backend:

```bash
cd trail_map/backend
npm start
```

Backend health:

```bash
curl http://localhost:3000/health
```

Start app:

```bash
cd trail_map
flutter run
```

Networking note:

- Android emulator: `BACKEND_BASE_URL=http://10.0.2.2:3000`
- Physical Android phone on same Wi-Fi: `http://<your_laptop_lan_ip>:3000`
- Physical phone on mobile data: use a deployed API URL (or temporary tunnel)

## 7. Authentication and Sync Validation

Minimum manual checks:

1. Register user from app
2. Login user
3. Save a place
4. Delete a place
5. Restart app and confirm local data persists
6. Trigger sync and confirm server reflects updates
7. Logout/login and verify auth headers still work

## 8. Testing Checklist

### 8.1 Backend

```bash
cd trail_map/backend
npm test
```

Also validate:

- Auth endpoints (`/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`)
- Saved places sync endpoints (`/api/places/sync/pull`, `/api/places/sync/push`)
- Subscription webhook signature verification

### 8.2 Flutter

```bash
cd trail_map
flutter analyze
flutter test
```

### 8.3 Device checks

- Android 10+ real device
- Poor network / offline behavior
- Background/foreground lifecycle while syncing

## 9. Make Backend Production-Ready

1. Deploy backend to a host with HTTPS (Render, Railway, Fly.io, Cloud Run).
2. Set production env vars in hosting dashboard.
3. Set strict `ALLOWED_ORIGINS` (no wildcard).
4. Keep rate limiting enabled.
5. Rotate all secrets before launch, especially if ever exposed in client env.
6. Add monitoring:
   - uptime checks on `/health`
   - error tracking
   - log aggregation

## 10. Use Public Backend URL in App

After deployment, update app env:

```env
BACKEND_BASE_URL=https://api.yourdomain.com
```

Then rebuild app (hot reload is not enough for dotenv bootstrap changes).

## 11. Android Release and Play Store Publishing

1. Set final package name (do not keep `com.example...` for production).
2. Create release keystore.
3. Configure signing in Android Gradle.
4. Build AAB:

```bash
cd trail_map
flutter build appbundle --release
```

5. In Play Console:
   - create app
   - upload AAB
   - complete Data safety and app content forms
   - add privacy policy URL
   - configure testers (internal testing track first)

6. Configure Google Maps API restrictions for release:
   - package name
   - SHA-1 from Play App Signing

## 12. Pre-Launch Gate

Do not publish until all are true:

- Backend is reachable over public HTTPS
- No server secrets in Flutter assets or client env
- Login/register works on real device
- Saved places local-first behavior works when offline
- Sync recovers correctly after reconnect
- Crash-free smoke test on internal testing track

## 13. Post-Launch Operations

- Monitor error rate, latency, and payment webhook success
- Rotate secrets periodically
- Keep dependencies updated
- Add CI/CD gates (lint, test, build) before production deploy

