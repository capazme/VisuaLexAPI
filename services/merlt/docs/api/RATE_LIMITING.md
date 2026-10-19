# MERL-T API - Rate Limiting Guide

**Version**: 0.2.0
**Last Updated**: November 14, 2025

---

## Overview

The MERL-T API implements **sliding window rate limiting** to ensure fair usage and system stability. Rate limits are applied per API key and vary by subscription tier.

---

## Rate Limit Tiers

| Tier | Requests/Hour | Burst Limit | Priority Queue |
|------|---------------|-------------|----------------|
| **Unlimited** (Dev) | 999,999 | 100 | ❌ |
| **Premium** | 1,000 | 50 | ✅ |
| **Standard** | 100 | 20 | ❌ |
| **Limited** | 10 | 5 | ❌ |

**Sliding Window**: Limits reset continuously, not at fixed hourly intervals.

---

## Rate Limit Headers

Every API response includes the following headers:

### Response Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1699999999
X-RateLimit-Used: 1
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Total requests allowed per hour |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when limit resets |
| `X-RateLimit-Used` | Requests used in current window |

### Example Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1699999999
X-RateLimit-Used: 5

{
  "trace_id": "QRY-20251114-abc123",
  "query": "È valido un contratto firmato da un sedicenne?",
  "answer": {...}
}
```

---

## Rate Limit Exceeded (429)

When you exceed your rate limit, you'll receive a **429 Too Many Requests** error:

### Error Response

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699999999
Retry-After: 3600

{
  "detail": "Rate limit exceeded. Limit: 100 requests/hour",
  "limit": 100,
  "remaining": 0,
  "reset_at": "2025-11-14T16:00:00Z",
  "retry_after_seconds": 3600
}
```

### Retry-After Header

The `Retry-After` header tells you how many seconds to wait before retrying:

```http
Retry-After: 3600
```

This means **wait 1 hour** (3600 seconds) before making another request.

---

## Handling Rate Limits

### Python Example with Exponential Backoff

```python
import requests
import time

def execute_query_with_retry(query, max_retries=3):
    """Execute query with automatic retry on rate limit."""
    api_key = "your-api-key-here"
    base_url = "http://localhost:8000"

    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json"
    }

    for attempt in range(max_retries):
        response = requests.post(
            f"{base_url}/query/execute",
            headers=headers,
            json={"query": query}
        )

        # Check rate limit headers
        remaining = int(response.headers.get("X-RateLimit-Remaining", 0))
        limit = int(response.headers.get("X-RateLimit-Limit", 0))

        print(f"Rate limit: {remaining}/{limit} remaining")

        if response.status_code == 200:
            return response.json()

        elif response.status_code == 429:
            # Rate limit exceeded
            retry_after = int(response.headers.get("Retry-After", 60))
            print(f"Rate limit exceeded. Retrying in {retry_after}s...")

            if attempt < max_retries - 1:
                time.sleep(retry_after)
            else:
                raise Exception("Max retries exceeded")

        else:
            # Other error
            response.raise_for_status()

    raise Exception("Failed after all retries")

# Usage
try:
    result = execute_query_with_retry(
        "È valido un contratto firmato da un sedicenne?"
    )
    print(f"Answer: {result['answer']['primary_answer']}")
except Exception as e:
    print(f"Error: {e}")
```

### JavaScript Example with Rate Limit Checking

```javascript
async function executeQueryWithRateLimit(query) {
  const API_KEY = "your-api-key-here";
  const BASE_URL = "http://localhost:8000";

  const response = await fetch(`${BASE_URL}/query/execute`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  // Check rate limit headers
  const remaining = parseInt(response.headers.get("X-RateLimit-Remaining"));
  const limit = parseInt(response.headers.get("X-RateLimit-Limit"));
  const resetTime = parseInt(response.headers.get("X-RateLimit-Reset"));

  console.log(`Rate limit: ${remaining}/${limit} remaining`);

  if (remaining < 10) {
    const resetDate = new Date(resetTime * 1000);
    console.warn(`⚠️  Only ${remaining} requests remaining until ${resetDate}`);
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After"));
    throw new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}
```

### Proactive Rate Limit Monitoring

```python
def check_rate_limit(response):
    """Monitor rate limit and warn when approaching limit."""
    remaining = int(response.headers.get("X-RateLimit-Remaining", 0))
    limit = int(response.headers.get("X-RateLimit-Limit", 0))
    reset_ts = int(response.headers.get("X-RateLimit-Reset", 0))

    usage_percent = ((limit - remaining) / limit) * 100

    if usage_percent > 90:
        print(f"⚠️  WARNING: {usage_percent:.0f}% of rate limit used!")
        print(f"   Remaining: {remaining}/{limit}")

        # Calculate time until reset
        import datetime
        reset_time = datetime.datetime.fromtimestamp(reset_ts)
        now = datetime.datetime.now()
        time_until_reset = (reset_time - now).total_seconds() / 60

        print(f"   Resets in: {time_until_reset:.0f} minutes")

    return remaining
```

---

## Best Practices

### 1. Monitor Rate Limit Headers

**Always check rate limit headers** in your responses:

```python
def make_request(url, headers, data):
    response = requests.post(url, headers=headers, json=data)

    # Monitor rate limits
    remaining = int(response.headers.get("X-RateLimit-Remaining", 0))
    if remaining < 10:
        print(f"⚠️  Low rate limit: {remaining} requests remaining")

    return response
```

### 2. Implement Exponential Backoff

When rate limited, **wait exponentially** longer between retries:

```python
import time

def exponential_backoff(attempt, base_delay=1, max_delay=60):
    """Calculate exponential backoff delay."""
    delay = min(base_delay * (2 ** attempt), max_delay)
    return delay

for attempt in range(5):
    response = make_request(...)
    if response.status_code == 429:
        delay = exponential_backoff(attempt)
        print(f"Waiting {delay}s before retry...")
        time.sleep(delay)
    else:
        break
```

### 3. Batch Requests

**Combine multiple operations** into single requests when possible:

```python
# ❌ Bad: Multiple separate requests
for query in queries:
    response = execute_query(query)  # Uses 1 request per query

# ✅ Good: Batch processing
batch_response = execute_batch_queries(queries)  # Uses 1 request total
```

### 4. Cache Responses

**Cache frequent queries** to reduce API calls:

```python
import hashlib
import json
from functools import lru_cache

@lru_cache(maxsize=1000)
def cached_query(query_hash):
    """Execute query with caching."""
    return execute_query(query_hash)

def query_with_cache(query_text):
    # Create stable hash of query
    query_hash = hashlib.sha256(query_text.encode()).hexdigest()
    return cached_query(query_hash)
```

### 5. Use Webhooks for Long Operations

For operations that take time, use **async patterns** instead of polling:

```python
# ❌ Bad: Polling wastes rate limit
while not is_complete(trace_id):
    time.sleep(5)
    status = check_status(trace_id)  # Uses rate limit

# ✅ Good: Webhook callback (future feature)
execute_query_async(query, callback_url="https://myapp.com/callback")
```

---

## Rate Limit Calculation

### Sliding Window Algorithm

MERL-T uses a **sliding window** approach:

```
Time:       00:00    00:30    01:00    01:30
Requests:   [50]     [30]     [20]     [40]
Window:     |--------- 100 total ---------|

At 01:30:
- Last hour: 00:30 to 01:30
- Total requests: 30 + 20 + 40 = 90
- Remaining: 100 - 90 = 10
```

### Fixed Window vs Sliding Window

**Fixed Window** (not used):
```
00:00-01:00: 100 requests ✅
01:00-02:00: Reset to 0, then 100 requests ✅
```

**Sliding Window** (MERL-T):
```
00:00: 50 requests
00:30: 50 more (100 total in last hour) ❌ Rate limited!
01:00: 50 from 00:00 expire, 50 remaining
01:00: Can make 50 more requests ✅
```

**Advantage**: Smoother distribution, prevents burst abuse at window boundaries.

---

## Upgrading Your Tier

### Current Tier

Check your current tier:

```bash
curl -X GET "http://localhost:8000/stats/feedback" \
  -H "X-API-Key: your-key"

# Response includes tier info
{
  "tier": "standard",
  "rate_limit": 100,
  "requests_used_today": 45
}
```

### Upgrade Options

To upgrade your rate limit tier:

1. **Login** to [https://api.merl-t.alis.ai/dashboard](https://api.merl-t.alis.ai/dashboard)
2. Navigate to **Billing → Upgrade Plan**
3. Select your desired tier:
   - **Standard**: €9/month (100 req/hour)
   - **Premium**: €49/month (1,000 req/hour)
   - **Enterprise**: Custom pricing (unlimited)
4. Update payment method
5. Upgrade takes effect immediately

---

## Rate Limit by Endpoint

Some endpoints have **different rate limits**:

| Endpoint | Multiplier | Example (100/hr tier) |
|----------|------------|----------------------|
| `POST /query/execute` | 1x | 100 requests/hour |
| `POST /feedback/*` | 0.1x | 1000 requests/hour |
| `GET /query/status/*` | 0.5x | 200 requests/hour |
| `GET /stats/*` | 0.2x | 500 requests/hour |

**Why?** Heavy operations (query execution) count more than lightweight operations (status checks).

---

## Monitoring and Analytics

### Dashboard

View your rate limit usage in the dashboard:

- **Requests today**: Total API calls in last 24 hours
- **Peak hour**: Hour with most requests
- **Average per hour**: Daily average
- **Trend graph**: Usage over time

### API Endpoint

Get rate limit statistics programmatically:

```bash
curl -X GET "http://localhost:8000/stats/rate-limit" \
  -H "X-API-Key: your-key"
```

**Response**:
```json
{
  "tier": "standard",
  "limit_per_hour": 100,
  "current_hour_usage": 45,
  "today_total": 342,
  "this_month_total": 8567,
  "peak_hour_today": {
    "hour": "14:00-15:00",
    "requests": 89
  },
  "forecast_overage": false
}
```

---

## Troubleshooting

### Issue: Rate limit resets too slowly

**Cause**: Sliding window takes 1 hour to fully reset.

**Solution**: Requests expire exactly 1 hour after they were made. If you made 100 requests at 14:00, they'll expire at 15:00.

### Issue: Getting 429 errors despite low usage

**Possible Causes**:
- Shared API key across multiple services
- Burst limit exceeded (too many requests in short time)
- Incorrect tier configuration

**Solution**:
```bash
# Check current usage
curl -X GET "http://localhost:8000/stats/rate-limit" \
  -H "X-API-Key: your-key"

# Verify tier
# Contact support if limit seems incorrect
```

### Issue: Rate limit headers missing

**Cause**: Older API version or middleware issue.

**Solution**: Ensure you're using API v0.2.0 or later. All responses should include rate limit headers.

---

## Future Enhancements

Planned rate limiting features:

- **Per-endpoint rate limits** (beta)
- **Burst allowances** for premium tiers
- **Rate limit increase requests** via API
- **Real-time usage dashboard**
- **Webhook notifications** at 80% usage

---

## Support

For rate limiting issues:

- **Email**: support@alis.ai
- **Dashboard**: https://api.merl-t.alis.ai/dashboard
- **Status Page**: https://status.merl-t.alis.ai

---

## Next Steps

- [Authentication Guide](./AUTHENTICATION.md) - Set up API key authentication
- [API Examples](./API_EXAMPLES.md) - Practical usage examples
- [Upgrade Your Plan](https://api.merl-t.alis.ai/billing) - Increase rate limits

---

**Last Updated**: November 14, 2025
**Version**: 0.2.0
