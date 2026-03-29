# Production Monitoring & Alerting Setup

Date: March 29, 2026  
Version: 1.0

---

## 1. Structured Logging Infrastructure

### JSON Logging Format

All logs are structured JSON with the following format:

```json
{
  "timestamp": "2026-03-29T10:30:45.123Z",
  "level": "info|warn|error|debug",
  "message": "Operation description",
  "service": "trail-map-backend",
  "userId": "user123",
  "requestId": "req-456",
  "endpoint": "/api/places",
  "method": "POST",
  "statusCode": 200,
  "duration": 145,
  "error": {
    "name": "ValidationError",
    "message": "Invalid input",
    "stack": "..."
  }
}
```

### Log Levels

- **debug**: Detailed debug information (not logged in production)
- **info**: General informational messages (successful operations)
- **warn**: Warning conditions (validation failures, slow queries)
- **error**: Error conditions (exceptions, failures)

### Example Logging in Code

```javascript
const logger = require('../utils/logger');

// Success
logger.info('Place created', { userId, placeId, duration: 145 });

// Validation failure
logger.warn('Invalid coordinates', { latitude, longitude, errors });

// Error
logger.error('Database transaction failed', { userId, error, stack: error.stack });
```

---

## 2. Rate Limiting Metrics

### Rate Limit Configuration

```javascript
// Default: 100 requests per 15 minutes per IP
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

// Auth: 10 requests per 15 minutes per IP
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX_REQUESTS=10
```

### Rate Limit Metrics Collection

Metrics are logged every 5 minutes with:

```json
{
  "timestamp": "2026-03-29T10:35:00Z",
  "level": "info",
  "message": "Rate limit metrics",
  "totalAttempts": 5432,
  "totalLimitExceeded": 12,
  "activeIPs": 342,
  "limitExceededIPs": 8,
  "topOffenders": [
    { "ip": "192.168.1.100", "limitExceededCount": 5 },
    { "ip": "10.0.0.50", "limitExceededCount": 3 }
  ]
}
```

### Detecting Brute Force Attacks

Monitor for:
1. **High rate limit exceeded count** - More than 3 occurrences in 5 minutes = possible attack
2. **Concentrated from single IP** - Same IP exceeding limit repeatedly
3. **Targeting auth endpoints** - Repeated 429 responses on `/api/auth/login`

---

## 3. Error Tracking Setup

### Option A: Sentry Integration (Recommended)

#### Installation

```bash
npm install --save @sentry/node
```

#### Setup in backend/src/server.js

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.OnUncaughtException(),
    new Sentry.Integrations.OnUnhandledRejection()
  ]
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

#### Environment Variables

```env
SENTRY_DSN=https://<key>@sentry.io/<project>
SENTRY_ENVIRONMENT=production
```

### Option B: Custom Error Webhook

The error-tracker.js service supports webhooks:

```env
ERROR_TRACKING_ENABLED=true
ERROR_WEBHOOK_URL=https://your-logging-service.com/errors
```

---

## 4. Health Check Endpoints

### GET /health

Basic health check:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T10:30:45.123Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### GET /health/deep

Deep health check (checks all dependencies):

```bash
curl http://localhost:3000/health/deep
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T10:30:45.123Z",
  "checks": {
    "firebase": "ok",
    "jwt": "ok",
    "smtp": "ok"
  },
  "uptime": 3600
}
```

---

## 5. Key Metrics to Monitor

### Performance Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Response Time (p95) | <500ms | >1000ms |
| Database Query Time (p95) | <200ms | >500ms |
| Sync Endpoint Latency | <1s | >2s |
| Error Rate | <0.1% | >1% |

### Availability Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Uptime | >99.9% | <99% |
| Health Check Pass Rate | 100% | <95% |
| Database Connection Pool | <80% | >90% |

### Security Metrics

| Metric | Target | Action |
|--------|--------|--------|
| Rate Limit Violations | <1/min | Investigate IP |
| Failed Auth Attempts | <5 per user/hour | Lock account |
| Invalid Tokens | <10/min | Check for attacks |

---

## 6. Alert Configuration

### Critical Alerts (Page on-call)

```yaml
- name: "High Error Rate"
  condition: "error_rate > 5%"
  duration: "5 minutes"
  severity: "critical"
  
- name: "Database Connection Exhausted"
  condition: "db_connections > 95%"
  duration: "2 minutes"
  severity: "critical"
  
- name: "Sync Transaction Failure"
  condition: "transaction_failures > 10/minute"
  duration: "5 minutes"
  severity: "critical"
```

### High Alerts (Notify team)

```yaml
- name: "Slow API Response"
  condition: "api_response_time_p95 > 1000ms"
  duration: "10 minutes"
  severity: "high"
  
- name: "High Rate Limit Violations"
  condition: "rate_limit_violations > 50/hour"
  duration: "15 minutes"
  severity: "high"
```

### Medium Alerts (Log and review)

```yaml
- name: "Elevated Error Rate"
  condition: "error_rate > 1%"
  duration: "15 minutes"
  severity: "medium"
  
- name: "Authentication Failures"
  condition: "failed_auth > 20/hour"
  duration: "30 minutes"
  severity: "medium"
```

---

## 7. Log Aggregation Setup

### Option A: Google Cloud Logging

```javascript
// Already integrated via Firestore logs
// Logs appear in Google Cloud Console > Logging
```

**Dashboard:**
```
resource.type="gce_instance"
resource.labels.instance_id="<your-instance>"
labels.service="trail-map-backend"
severity >= "WARNING"
```

### Option B: ELK Stack (Elasticsearch, Logstash, Kibana)

#### Docker Compose Example

```yaml
version: '3'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
    environment:
      - ELASTICSEARCH_INITIAL_PASSWORD_HASH=<hash>
    ports:
      - "9200:9200"

  logstash:
    image: docker.elastic.co/logstash/logstash:8.0.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    ports:
      - "5000:5000"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.0.0
    ports:
      - "5601:5601"
```

#### Configure Node.js to send logs

```javascript
const { Client } = require('@elastic/elasticsearch');
const client = new Client({ node: 'http://localhost:9200' });

const logToElasticsearch = async (log) => {
  await client.index({
    index: `logs-${new Date().toISOString().split('T')[0]}`,
    body: log
  });
};
```

---

## 8. Monitoring Dashboard Queries

### API Response Time Distribution

```
SELECT 
  endpoint,
  AVG(duration) as avg_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration) as p99_ms
FROM logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY endpoint
ORDER BY p95_ms DESC;
```

### Error Rate by Endpoint

```
SELECT 
  endpoint,
  COUNT(*) as total_requests,
  COUNTIF(statusCode >= 400) as error_count,
  ROUND(100 * COUNTIF(statusCode >= 400) / COUNT(*), 2) as error_rate_pct
FROM logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY endpoint
ORDER BY error_rate_pct DESC;
```

### Rate Limit Violations by IP

```
SELECT 
  ip,
  COUNT(*) as violation_count,
  MAX(timestamp) as last_violation
FROM logs
WHERE message = 'Rate limit exceeded'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY ip
ORDER BY violation_count DESC
LIMIT 20;
```

### Transaction Failure Tracking

```
SELECT 
  DATE_TRUNC(timestamp, MINUTE) as minute,
  COUNTIF(message LIKE 'transaction%failed%') as failures,
  COUNTIF(message LIKE 'transaction%completed%') as successes
FROM logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY minute
ORDER BY minute DESC;
```

---

## 9. Regular Health Checks

### Daily Checklist

- [ ] Verify all health check endpoints responding (200 OK)
- [ ] Check error rate is < 0.5%
- [ ] Verify rate limit violations < 5/hour
- [ ] Check database response times (p95 < 200ms)
- [ ] Review Sentry/error tracking dashboard for new errors
- [ ] Verify backup completion from previous night

### Weekly Checklist

- [ ] Review security logs for suspicious patterns
- [ ] Analyze error trends and frequency
- [ ] Check coverage reports for regressions
- [ ] Verify all test suites passing
- [ ] Review slow query logs
- [ ] Capacity planning: disk usage, memory, connections

### Monthly Checklist

- [ ] Full security audit of logs
- [ ] Performance baseline comparison
- [ ] Update runbooks with recent incident learnings
- [ ] Test full disaster recovery procedure
- [ ] Review and update monitoring thresholds
- [ ] Analyze and optimize top slow endpoints

---

## 10. Runbook Example: High Error Rate

**Alert:** Error rate > 5% for 5 minutes  
**Severity:** Critical  
**On-Call:** Page immediately

### Investigation Steps

1. **Identify errors:**
   ```bash
   # Query logs for errors in last 15 minutes
   SELECT message, count FROM logs 
   WHERE level='error' AND timestamp > NOW() - 15 MINUTES
   ```

2. **Check affected endpoints:**
   ```bash
   # Which endpoints are failing?
   SELECT endpoint, count(*) FROM logs 
   WHERE statusCode >= 500 
   GROUP BY endpoint
   ```

3. **Check database status:**
   ```bash
   # Verify Firestore is healthy
   curl https://console.firebase.google.com/status
   ```

4. **Check external dependencies:**
   - [ ] SMTP service availability
   - [ ] Google Maps API status
   - [ ] Any 3rd party integrations

5. **Decision tree:**
   - **If database issue:** Contact GCP support, check billing
   - **If SMTP issue:** Review mail logs, check credentials
   - **If code issue:** Check recent deployments, consider rollback
   - **If rate-based:** Check for DDoS, review rate limit metrics

6. **Actions:**
   - [ ] Scale up instances if needed
   - [ ] Clear connection pools if stuck
   - [ ] Rollback recent changes if possible
   - [ ] Enable fallback mode if available

---

## 11. Integration With On-Call System

### PagerDuty Integration

```javascript
const pagerduty = require('node-pagerduty');

const createIncident = async (alert) => {
  await pagerduty.incidents.create({
    title: alert.title,
    service_id: process.env.PAGERDUTY_SERVICE_ID,
    incident_key: `trail-map-${Date.now()}`,
    urgency: 'high',
    body: {
      type: 'incident_body',
      details: alert.details
    }
  });
};
```

### Slack Notifications

```javascript
const slack = require('@slack/web-api').WebClient;

const notifySlack = async (message) => {
  const client = new slack(process.env.SLACK_TOKEN);
  await client.chat.postMessage({
    channel: '#alerts',
    text: message,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: message }
    }]
  });
};
```

---

## References

- [Google Cloud Logging](https://cloud.google.com/logging)
- [Sentry Documentation](https://docs.sentry.io/product/integrations/azure/)
- [ELK Stack Setup](https://www.elastic.co/guide/en/elasticsearch/reference/current/install-elasticsearch.html)
- [PagerDuty API](https://pagerduty.com/developer/api/)
