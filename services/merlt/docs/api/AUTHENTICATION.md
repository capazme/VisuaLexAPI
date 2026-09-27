# MERL-T API - Authentication Guide

**Version**: 0.2.0
**Last Updated**: November 14, 2025

---

## Overview

The MERL-T API uses **API Key authentication** via the `X-API-Key` HTTP header. This simple and secure authentication method ensures that only authorized users can access the legal research and analysis endpoints.

---

## Authentication Method

### API Key Header

All API requests (except `/` and `/health`) require an API key in the request headers:

```http
X-API-Key: your-api-key-here
```

**Security Scheme Type**: `apiKey`
**Header Name**: `X-API-Key`
**Location**: HTTP Header

---

## Getting Your API Key

### Development Environment

For local development, you can use a test API key:

```bash
# Set in .env file
API_KEY=dev-test-key-12345

# Or export as environment variable
export API_KEY=dev-test-key-12345
```

### Production Environment

To obtain a production API key:

1. **Register** at [https://api.merl-t.alis.ai/register](https://api.merl-t.alis.ai/register)
2. **Verify** your email address
3. **Generate** an API key from your dashboard
4. **Copy** and securely store your API key

⚠️ **Important**: Never commit API keys to version control or share them publicly.

---

## Making Authenticated Requests

### cURL Example

```bash
curl -X POST "http://localhost:8000/query/execute" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "È valido un contratto firmato da un sedicenne?",
    "context": {
      "jurisdiction": "nazionale",
      "temporal_reference": "latest",
      "user_role": "cittadino"
    }
  }'
```

### Python Example

```python
import requests

API_KEY = "your-api-key-here"
BASE_URL = "http://localhost:8000"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

response = requests.post(
    f"{BASE_URL}/query/execute",
    headers=headers,
    json={
        "query": "È valido un contratto firmato da un sedicenne?",
        "context": {
            "jurisdiction": "nazionale",
            "temporal_reference": "latest",
            "user_role": "cittadino"
        }
    }
)

if response.status_code == 200:
    result = response.json()
    print(f"Answer: {result['answer']['primary_answer']}")
else:
    print(f"Error: {response.status_code} - {response.text}")
```

### JavaScript (Fetch) Example

```javascript
const API_KEY = "your-api-key-here";
const BASE_URL = "http://localhost:8000";

async function executeQuery(query) {
  const response = await fetch(`${BASE_URL}/query/execute`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query,
      context: {
        jurisdiction: "nazionale",
        temporal_reference: "latest",
        user_role: "cittadino"
      }
    })
  });

  if (response.ok) {
    const result = await response.json();
    console.log("Answer:", result.answer.primary_answer);
  } else {
    console.error("Error:", response.status, await response.text());
  }
}

executeQuery("È valido un contratto firmato da un sedicenne?");
```

### Postman Example

1. Import the MERL-T Postman collection
2. Select the "MERL-T API Environment"
3. Edit the environment variables:
   - `base_url`: `http://localhost:8000`
   - `api_key`: `your-api-key-here`
4. All requests will automatically include the `X-API-Key` header

---

## Authentication Errors

### 401 Unauthorized - Missing API Key

**Error Response**:
```json
{
  "detail": "Missing API key. Include 'X-API-Key' header in your request."
}
```

**Solution**: Add the `X-API-Key` header to your request.

### 403 Forbidden - Invalid API Key

**Error Response**:
```json
{
  "detail": "Invalid API key. Check your credentials or regenerate your key."
}
```

**Solutions**:
- Verify your API key is correct
- Check for extra spaces or newlines
- Regenerate your API key if compromised

### 403 Forbidden - API Key Revoked

**Error Response**:
```json
{
  "detail": "API key has been revoked. Please contact support or generate a new key."
}
```

**Solution**: Generate a new API key from your dashboard.

---

## API Key Management

### Best Practices

1. **Never hardcode API keys** in your source code
2. **Use environment variables** or secure configuration files
3. **Rotate keys regularly** (recommended: every 90 days)
4. **Use different keys** for development, staging, and production
5. **Revoke compromised keys** immediately

### Secure Storage

#### Using Environment Variables

```bash
# .env file (add to .gitignore!)
MERL_T_API_KEY=your-api-key-here
```

```python
# Python
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("MERL_T_API_KEY")
```

```javascript
// JavaScript/Node.js
require('dotenv').config();
const API_KEY = process.env.MERL_T_API_KEY;
```

#### Using Secret Managers

**AWS Secrets Manager**:
```python
import boto3
import json

def get_api_key():
    client = boto3.client('secretsmanager', region_name='eu-west-1')
    secret = client.get_secret_value(SecretId='merl-t/api-key')
    return json.loads(secret['SecretString'])['api_key']
```

**HashiCorp Vault**:
```python
import hvac

client = hvac.Client(url='http://localhost:8200')
secret = client.secrets.kv.v2.read_secret_version(path='merl-t/api-key')
api_key = secret['data']['data']['key']
```

### Key Rotation

To rotate your API key:

1. **Generate** a new API key
2. **Update** your application configuration with the new key
3. **Deploy** the updated configuration
4. **Verify** the new key works
5. **Revoke** the old key

---

## Rate Limiting

API keys are subject to rate limiting based on your subscription tier. See [RATE_LIMITING.md](./RATE_LIMITING.md) for details.

### Rate Limit Headers

Every response includes rate limiting information:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1699999999
X-RateLimit-Used: 1
```

---

## Public Endpoints (No Authentication)

The following endpoints do **not** require authentication:

- `GET /` - API welcome page
- `GET /health` - Health check endpoint
- `GET /docs` - Swagger UI documentation
- `GET /redoc` - ReDoc documentation

All other endpoints require a valid API key.

---

## Troubleshooting

### Issue: "Missing API key" error despite providing header

**Possible Causes**:
- Header name typo (must be exactly `X-API-Key`)
- Missing header in middleware configuration
- Reverse proxy stripping headers

**Solution**:
```bash
# Verify header is being sent
curl -v -X GET "http://localhost:8000/query/status/test" \
  -H "X-API-Key: your-key"

# Check for 'X-API-Key' in request headers output
```

### Issue: API key works in Postman but not in code

**Possible Causes**:
- Hidden characters (spaces, newlines) in API key
- Incorrect header casing

**Solution**:
```python
# Trim whitespace
api_key = os.getenv("API_KEY").strip()

# Verify header name
headers = {
    "X-API-Key": api_key,  # Correct: X-API-Key
    # Not: "x-api-key" or "X-Api-Key"
}
```

### Issue: 403 error with correct API key

**Possible Causes**:
- API key expired
- Account suspended
- IP address blocked

**Solution**: Contact support at support@alis.ai

---

## Security Considerations

### HTTPS in Production

**Always use HTTPS** in production to prevent API key interception:

```python
# ✅ Correct: HTTPS
BASE_URL = "https://api.merl-t.alis.ai"

# ❌ Wrong: HTTP (insecure!)
BASE_URL = "http://api.merl-t.alis.ai"
```

### API Key Length

MERL-T API keys are 32-character alphanumeric strings:

```
Example: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Scope and Permissions

API keys have the following scopes:

- `query:execute` - Execute legal queries
- `query:history` - Access query history
- `feedback:submit` - Submit feedback
- `stats:read` - View statistics

---

## API Key Tiers

| Tier | Rate Limit | Features |
|------|------------|----------|
| **Free** | 10 req/hour | Basic queries, no history |
| **Standard** | 100 req/hour | Full queries, 30-day history |
| **Premium** | 1,000 req/hour | Priority queue, unlimited history |
| **Enterprise** | Unlimited | Custom deployment, SLA |

---

## Support

For authentication issues:

- **Email**: support@alis.ai
- **Discord**: https://discord.gg/alis-ai
- **GitHub Issues**: https://github.com/ALIS-ai/MERL-T/issues

---

## Next Steps

- [Rate Limiting Guide](./RATE_LIMITING.md) - Understand request limits
- [API Examples](./API_EXAMPLES.md) - Practical usage examples
- [Swagger UI](http://localhost:8000/docs) - Interactive API testing

---

**Last Updated**: November 14, 2025
**Version**: 0.2.0
