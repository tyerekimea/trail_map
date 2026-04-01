# Trail Map Backend API

This is the production backend for the Trail Map app.

## Stack

- Node.js + Express
- Firestore (Firebase Admin SDK)
- JWT access + refresh authentication
- Google Maps proxy endpoints

## Current Features

- Email/password auth (`/api/auth/*`)
- User profile and usage (`/api/users/*`)
- Saved places CRUD + sync (`/api/places/*`)
- Maps proxy (`/api/maps/*`, authenticated)
- Businesses search/admin (`/api/businesses/*`)
- Analytics ingestion/reporting (`/api/analytics/*`)
- Admin users/stats (`/api/admin/*`)

## Not Included

- Subscriptions and in-app payment routes (removed)

## Documentation Map

- Deployment: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Firestore schema: [SCHEMA.md](./SCHEMA.md)
- Monitoring and alerting: [ops/MONITORING_AND_ALERTING.md](./ops/MONITORING_AND_ALERTING.md)
- Backup and recovery: [ops/BACKUP_AND_RECOVERY.md](./ops/BACKUP_AND_RECOVERY.md)
- Secret rotation: [ops/SECRET_ROTATION.md](./ops/SECRET_ROTATION.md)

## Local Setup

1. Copy env template and fill values.

```bash
cp .env.example .env
```

2. Install dependencies and run:

```bash
npm ci
npm start
```

3. Verify service health:

```bash
curl http://localhost:3000/health
```

## Testing

```bash
npm run lint
npm test
npm run test:production-gate
npm run check:predeploy
```

Optional integration suites (real Firestore-dependent):

```bash
npm run test:integration
```

## Production Notes

- Use Secret Manager for secrets (JWT, Firestore private key, Maps key).
- Keep `ALLOWED_ORIGINS` explicit, no wildcard.
- Use `/health` and `/health/deep` for uptime checks.
- Configure either `SENTRY_DSN` or `ERROR_WEBHOOK_URL` for production error tracking.
