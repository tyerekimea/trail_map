# Secret Rotation Plan (Production)

## Scope

Rotate these secrets in Google Secret Manager:

- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL` (only when service account key is rotated)
- `GOOGLE_MAPS_API_KEY`

## Rotation Cadence

- JWT secrets: every 90 days
- Maps API key: every 90 days or immediately on suspected exposure
- Firestore service account key: every 180 days (or move to Workload Identity Federation where possible)
- Emergency rotation: immediately after incident or leak

## Standard Rotation Procedure

1. Create a new secret version in Secret Manager.
2. Grant Cloud Run runtime service account `roles/secretmanager.secretAccessor` on the secret.
3. Update Cloud Run service env secret references to `:latest`.
4. Deploy a new revision.
5. Verify:
   - `GET /health` is OK
   - login/refresh flow works
   - maps proxy works
6. Keep previous secret version enabled during canary window.
7. Disable old secret versions after validation window.

## JWT Rotation Strategy

- Access token secret rotation causes existing access tokens to expire naturally.
- Refresh token secret rotation invalidates all old refresh tokens.
- During planned rotation, announce forced re-login window for users.

## Command Examples

```bash
# Add new version
echo -n 'new-secret-value' | gcloud secrets versions add JWT_SECRET --data-file=-

# Bind accessor role to Cloud Run runtime service account
gcloud secrets add-iam-policy-binding JWT_SECRET \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Update Cloud Run secret references
gcloud run services update trail-map-backend \
  --region europe-west1 \
  --update-secrets JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest
```

## Post-Rotation Validation Checklist

- Auth register/login/refresh/logout all pass.
- `/api/maps/*` returns expected responses.
- No startup failures in Cloud Run logs.
- No spike in 401/5xx metrics after deploy.
