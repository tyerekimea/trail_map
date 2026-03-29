# Backup and Recovery (Firestore)

## Objective

Ensure user data can be restored after accidental deletion, corruption, or project incidents.

## Backup Strategy

1. Scheduled Firestore exports
   - Frequency: daily
   - Retention: 30 days minimum
   - Destination: dedicated GCS backup bucket
2. Pre-release backup
   - Run a manual export before major backend migrations.
3. Access control
   - Restrict bucket and export permissions to least privilege service accounts.

## Example Commands

```bash
gcloud firestore export gs://YOUR_BACKUP_BUCKET/firestore/$(date +%F) \
  --project YOUR_GCP_PROJECT_ID
```

```bash
gcloud firestore import gs://YOUR_BACKUP_BUCKET/firestore/2026-03-29 \
  --project YOUR_GCP_PROJECT_ID
```

## Recovery Runbook

1. Freeze writes (maintenance mode or revoke write traffic).
2. Identify restore point.
3. Import to staging first and validate critical collections.
4. Restore production.
5. Run smoke tests:
   - auth login
   - places pull/push
   - admin stats

## Validation Checklist

- Backups are running on schedule.
- Restore tested at least monthly.
- Recovery time objective (RTO) and recovery point objective (RPO) are documented.
