# API Usage Guide — Curl Examples

All endpoints require the `X-Tenant-ID` header (except `/health`).

---

## Setup

```bash
export API_BASE=http://localhost:3000
export TENANT_ID=your-tenant-id-here
```

---

## Health Check

```bash
# GET /health — No authentication required
curl -s "${API_BASE}/health" | jq .
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 3600,
    "deploymentColor": "blue",
    "dependencies": {
      "elasticsearch": { "status": "healthy", "latencyMs": 4 },
      "redis": { "status": "healthy", "latencyMs": 1 },
      "database": { "status": "healthy", "latencyMs": 7 }
    }
  }
}
```

---

## Documents

### Create a Document

```bash
curl -s -X POST "${API_BASE}/documents" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -d '{
    "title": "Q4 2024 Financial Report",
    "content": "This quarterly financial report covers revenue, expenses, and EBITDA for Q4 2024. Revenue grew 23% YoY to $4.2M. Operating margin improved to 18%.",
    "author": "alice@acmecorp.com",
    "tags": ["finance", "quarterly-report", "2024"],
    "fileUrl": "https://s3.acme.com/docs/q4-2024-report.pdf",
    "fileSize": 2456789,
    "mimeType": "application/pdf"
  }' | jq .
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "tenantId": "acme-corp-001",
    "title": "Q4 2024 Financial Report",
    "author": "alice@acmecorp.com",
    "tags": ["finance", "quarterly-report", "2024"],
    "isDeleted": false,
    "createdAt": "2024-12-15T10:30:00.000Z",
    "updatedAt": "2024-12-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "uuid-here",
    "timestamp": "2024-12-15T10:30:00.000Z",
    "took": 45
  }
}
```

---

### Get a Document

```bash
DOC_ID="550e8400-e29b-41d4-a716-446655440001"

curl -s "${API_BASE}/documents/${DOC_ID}" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

---

### Update Document Metadata

```bash
curl -s -X PATCH "${API_BASE}/documents/${DOC_ID}" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -d '{
    "title": "Q4 2024 Financial Report — Revised",
    "tags": ["finance", "quarterly-report", "2024", "revised"]
  }' | jq .
```

---

### Delete a Document (Soft Delete)

```bash
curl -s -X DELETE "${API_BASE}/documents/${DOC_ID}" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "id": "550e8400-e29b-41d4-a716-446655440001"
  }
}
```

---

## Search

### Basic Full-Text Search

```bash
curl -s "${API_BASE}/search?q=financial+report" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

### Search with Pagination

```bash
curl -s "${API_BASE}/search?q=policy&page=2&limit=20" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

### Fuzzy Search (handles typos)

```bash
curl -s "${API_BASE}/search?q=finacial+report&fuzzy=true" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

### Faceted Search (filter by tags)

```bash
curl -s "${API_BASE}/search?q=report&tags=finance,hr" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

### Search with Date Range Filter

```bash
curl -s "${API_BASE}/search?q=policy&dateFrom=2024-01-01&dateTo=2024-12-31" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

### Search by Author

```bash
curl -s "${API_BASE}/search?q=report&author=alice@acmecorp.com" \
  -H "X-Tenant-ID: ${TENANT_ID}" | jq .
```

**Search Response (200):**
```json
{
  "success": true,
  "data": {
    "hits": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "score": 2.1,
        "title": "Q4 2024 Financial Report",
        "author": "alice@acmecorp.com",
        "tags": ["finance", "quarterly-report", "2024"],
        "createdAt": "2024-12-15T10:30:00.000Z",
        "updatedAt": "2024-12-15T10:30:00.000Z",
        "highlights": {
          "title": ["Q4 2024 <em>Financial</em> <em>Report</em>"],
          "content": ["Revenue grew 23% YoY to $4.2M. Operating margin improved..."]
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "took": 12,
    "facets": {
      "tags": [
        { "key": "finance", "count": 5 },
        { "key": "quarterly-report", "count": 3 }
      ],
      "authors": [
        { "key": "alice@acmecorp.com", "count": 2 }
      ]
    }
  },
  "meta": {
    "requestId": "uuid-here",
    "timestamp": "2024-12-15T10:30:05.000Z",
    "took": 12,
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

---

## Error Responses

### 401 — Missing Tenant

```bash
curl -s -X POST "${API_BASE}/documents" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test"}' | jq .
```

```json
{
  "success": false,
  "error": {
    "code": "TENANT_ERROR",
    "message": "Missing X-Tenant-ID header",
    "requestId": "uuid-here",
    "timestamp": "2024-12-15T10:31:00.000Z"
  }
}
```

### 429 — Rate Limit Exceeded

```bash
# Will return 429 with Retry-After header when limit exceeded
HTTP 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0

{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "requestId": "uuid-here",
    "timestamp": "...",
    "retryAfter": 60
  }
}
```

---

## Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# All tests with coverage
npm run test:coverage
```

---

## Seed Test Data

```bash
# Create 3 tenants + 100 documents each
npm run seed
```

## Run Benchmark

```bash
# Requires running services
npm run benchmark
```
