# Monitoring and Alerting (Cloud Run + Firestore)

## Minimum Monitoring Baseline

1. Uptime checks
   - Monitor:
     - `GET /health`
     - `GET /health/deep`
2. Error rate alerts
   - Alert when 5xx responses exceed baseline.
3. Latency alerts
   - Alert on p95 latency for `/api/auth/*`, `/api/places/*`, `/api/maps/*`.
4. Resource alerts
   - CPU and memory for Cloud Run service.
5. Firestore quota alerts
   - Document reads/writes and error count.

## Suggested Alert Policies

- `backend-5xx-rate-high`
  - condition: HTTP 5xx ratio > 2% for 5 minutes
- `backend-latency-p95-high`
  - condition: p95 latency > 2s for 5 minutes
- `backend-instance-crash-loop`
  - condition: repeated revision restarts / cold start failures
- `firestore-errors-nonzero`
  - condition: Firestore error count > 0 over 5 minutes

## Logging

- Backend emits structured JSON logs.
- Include and propagate `x-request-id` for request correlation.

## On-call Runbook Starter

1. Check latest Cloud Run revision health.
2. Review error logs filtered by `requestId`.
3. Check Firestore availability and quota.
4. Roll back traffic to previous revision if deploy regression is confirmed.
