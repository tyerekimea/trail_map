# Backend Deployment Guide (Firestore)

This guide is for deploying the current backend in `trail_map/backend`.

Current stack:

- Node.js + Express
- Firestore via Firebase Admin SDK
- JWT auth
- Paystack subscriptions + webhook

This backend loads environment variables from `backend/.env`.

## 1. Prerequisites

- Node.js 18+ and npm 9+
- Firebase project with Firestore enabled
- Service account JSON from Firebase Console
- Paystack test/live keys
- A hosting provider (Render, Railway, Fly.io, or Cloud Run)

## 2. Required Environment Variables

Use `backend/.env.example` as a template.

Minimum required for boot:

```env
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://your-app-domain.com

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

JWT_SECRET=generate-a-long-random-secret
JWT_REFRESH_SECRET=generate-another-long-random-secret

PAYSTACK_SECRET_KEY=sk_live_xxx
PAYSTACK_PUBLIC_KEY=pk_live_xxx
PAYSTACK_WEBHOOK_SECRET=your-paystack-webhook-secret
```

Alternative Firestore credential option:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Notes:

- Keep `FIREBASE_PRIVATE_KEY` with escaped `\\n` in env dashboards.
- Never commit real secrets.
- Rotate any key that was ever exposed in a client `.env`.

## 3. Local Production-Like Validation

From `trail_map/backend`:

```bash
npm install
npm start
```

Verify:

```bash
curl http://localhost:3000/health
```

Expected response includes:

- `status: "ok"`
- `environment`

Quick endpoint smoke checks:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"test@example.com","password":"StrongPass123"}'
```

## 4. Deploy Option A: Render

### 4.1 One-time repo preparation (already added)

This repo now includes:

- `render.yaml` (Render Blueprint config)
- `backend/env.production.example` (production env template)
- `npm run check:prod-env` (env sanity checker)

### 4.2 Deploy with Blueprint (recommended)

1. Push repository to GitHub.
2. In Render: New -> Blueprint.
3. Select this repository.
4. Render reads `render.yaml` and creates `trail-map-backend`.
5. In service environment variables, fill all `sync: false` values.
6. Deploy.

### 4.3 Validate env values before first traffic

Use this locally with production-like values:

```bash
cd trail_map/backend
set -a
source env.production.example
set +a
npm run check:prod-env
```

Render gives a public HTTPS URL like:

- `https://your-backend.onrender.com`

Health check URL:

- `https://your-backend.onrender.com/health`

## 5. Deploy Option B: Railway

1. Push repository to GitHub.
2. Create a new Railway project from repo.
3. Set service root to `trail_map/backend`.
4. Add env vars from Section 2.
5. Deploy.

Railway gives a public HTTPS URL like:

- `https://your-backend.up.railway.app`

## 6. CORS and Frontend URLs

Set explicit origins in `ALLOWED_ORIGINS`:

```env
ALLOWED_ORIGINS=https://app.yourdomain.com,https://www.yourdomain.com
```

For mobile-only API usage, keep at least your known web/admin origins here.

## 7. Paystack Webhook Setup

1. In Paystack dashboard, set webhook URL to:

- `https://your-backend-domain.com/api/subscriptions/webhook`

2. Set `PAYSTACK_WEBHOOK_SECRET` in host env vars.
3. Ensure webhook endpoint is reachable publicly and returns 2xx for valid events.

## 8. App Configuration After Deploy

Update Flutter app root `.env`:

```env
BACKEND_BASE_URL=https://your-backend-domain.com
```

Then fully rebuild the app (dotenv is loaded at app start).

Also set this same deployed URL in backend env:

```env
API_URL=https://your-backend-domain.com
```

## 9. Production Hardening Checklist

- `NODE_ENV=production`
- Strong random JWT secrets
- HTTPS only
- Strict `ALLOWED_ORIGINS`
- Rate limit enabled
- Request validation enabled for non-map write routes
- Monitoring on `/health`
- Error tracking/log aggregation enabled
- Backup and recovery plan for Firestore

## 10. Operational Checks After Go-Live

Run these after every deploy:

1. `GET /health` returns `status: ok`
2. Register/login flow works
3. Authenticated endpoint works (`/api/places` with bearer token)
4. Paystack verify endpoint works
5. Paystack webhook receives and processes test event
6. No 5xx spikes in logs

## 11. Troubleshooting

### Firestore init error at startup

- Confirm `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` are set.
- Confirm private key has escaped `\\n` in env dashboard.
- Confirm service account has permission for Firestore.

### CORS origin blocked

- Add exact origin to `ALLOWED_ORIGINS`.
- Redeploy/restart service after env changes.

### App times out on login/register

- Confirm backend public URL is reachable in browser/curl.
- Confirm app `BACKEND_BASE_URL` points to deployed HTTPS URL.
- Confirm no emulator-only URL (`10.0.2.2`) is used in production builds.

## 12. Recommended Next Improvements

- Add structured logging (JSON logs)
- Add Sentry or similar error monitoring
- Add CI/CD deploy gates (`npm test`, lint)
- Add automated post-deploy smoke tests
