# Monitoring Quick Reference

## Setup (5 minutes)

1. **Get Sentry DSN**: Sign up at [sentry.io](https://sentry.io) and create a project
2. **Configure**: Add to `.env`:
   ```bash
   SENTRY_DSN=https://your-dsn@sentry.io/project-id
   ```
3. **Install**: 
   ```bash
   pip install -r requirements-monitoring.txt
   ```
4. **Restart**: Backend automatically initializes Sentry on startup

## Usage

### Capture Exceptions
```python
from vnibb.core.monitoring import capture_exception

try:
    risky_operation()
except Exception as e:
    capture_exception(e, context={"user_id": user.id})
```

### Capture Messages
```python
from vnibb.core.monitoring import capture_message

capture_message(
    "User completed onboarding",
    level="info",
    context={"user_id": 123}
)
```

### Track Operations
```python
from vnibb.core.monitoring import track_operation

with track_operation("database.query", "Fetch user data"):
    result = await db.execute(query)
```

### Set User Context
```python
from vnibb.core.monitoring import set_user_context

set_user_context(
    user_id=str(user.id),
    username=user.username
)
```

## Features

- ✅ Automatic error tracking
- ✅ Performance monitoring (10% sample rate)
- ✅ Request correlation IDs
- ✅ Sensitive data filtering
- ✅ Stack traces with context
- ✅ Email/Slack alerts

## Correlation IDs

Every request gets a unique correlation ID:
- Request header: `X-Correlation-ID` (optional)
- Response header: `X-Correlation-ID` (always present)
- Logged in Sentry events
- Useful for tracing requests across services

## Configuration

Environment variables:
```bash
SENTRY_DSN=                      # Required - get from sentry.io
SENTRY_TRACES_SAMPLE_RATE=0.1   # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1 # 10% of requests profiled
```

## Monitoring Dashboard

Access your Sentry dashboard at:
```
https://sentry.io/organizations/your-org/projects/vnibb-backend/
```

Key sections:
- **Issues**: Error tracking and grouping
- **Performance**: Response time metrics
- **Releases**: Track errors by version

## Troubleshooting

**Errors not appearing?**
1. Check `SENTRY_DSN` is set
2. Look for "Sentry initialized" in logs
3. Test with: `curl http://localhost:8000/api/v1/test/sentry`

**Too many events?**
- Reduce `SENTRY_TRACES_SAMPLE_RATE` to 0.05 (5%)
- Filter noisy errors in `monitoring.py`

## Full Documentation

See [MONITORING_SETUP.md](../MONITORING_SETUP.md) for complete setup guide.
