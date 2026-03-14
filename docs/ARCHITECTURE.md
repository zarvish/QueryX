# Architecture Design: Distributed Document Search Service

## Overview

QueryX is a multi-tenant distributed document search service designed to handle 10M+ documents with sub-500ms search latency at the 95th percentile and over 1,000 concurrent searches per second.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│         (REST clients, SaaS apps, internal services)            │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER (Nginx)                         │
│           Blue/Green traffic routing, SSL termination            │
└────────────┬─────────────────────────┬──────────────────────────┘
             │                         │
             ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐
    │   API Node Blue  │      │  API Node Green  │
    │  (Node.js 20)   │      │  (Node.js 20)    │
    │  Express + TS   │      │  Express + TS    │
    └────────┬────────┘      └────────┬─────────┘
             │                        │
             ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MIDDLEWARE LAYER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │Tenant Auth   │  │  Rate Limit  │  │  Request Logger      │  │
│  │(X-Tenant-ID) │  │  (Redis SW)  │  │  (Pino structured)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌────────────┐ ┌─────────────┐
   │  Documents  │ │   Search   │ │   Health    │
   │   Module    │ │   Module   │ │   Module    │
   └──────┬──────┘ └─────┬──────┘ └──────┬──────┘
          │               │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                   │
│  ┌─────────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │   PostgreSQL     │  │ Elasticsearch  │  │      Redis       │  │
│  │  (Prisma ORM)   │  │  (Full-text)  │  │ (Cache+RateLimit)│  │
│  │  Tenant+Doc     │  │  Per-tenant   │  │  TTL-based       │  │
│  │  metadata       │  │  indices       │  │  sliding window  │  │
│  └─────────────────┘  └───────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Document Indexing

```
Client POST /documents
   │
   ├─► Tenant Middleware
   │       Validate X-Tenant-ID header (regex + DB lookup)
   │       Attach tenantId to request context
   │
   ├─► Rate Limit Middleware
   │       Redis sliding window check (per tenant)
   │       429 if limit exceeded, Retry-After header
   │
   ├─► DocumentController
   │       Zod schema validation of request body
   │
   ├─► DocumentService
   │   │
   │   ├─► DocumentRepository.create()
   │   │       INSERT INTO documents (tenantId, title, content, ...)
   │   │       Returns document with generated UUID
   │   │
   │   ├─► Elasticsearch.index()
   │   │       Ensure tenant index exists (documents_{tenantId})
   │   │       PUT /documents_{tenantId}/_doc/{id}
   │   │       Non-blocking — failure doesn't fail the request
   │   │
   │   └─► Redis Cache Invalidation
   │           DEL doc:{tenantId}:{docId}
   │           SCAN + DEL search:{tenantId}:*
   │
   └─► 201 Response { success: true, data: DocumentDto }
```

---

## Data Flow: Search Operation

```
Client GET /search?q=finance&tenant=acme&page=1&fuzzy=true
   │
   ├─► Tenant Middleware → Rate Limit Middleware
   │
   ├─► SearchController
   │       Zod validation of query params
   │
   └─► SearchService
       │
       ├─► Redis.get(search:{tenantId}:{md5(query)})  ← Cache check
       │       HIT → Return cached result immediately (~1ms)
       │       MISS → Continue to Elasticsearch
       │
       ├─► Elasticsearch.search()
       │       Index: documents_{tenantId}
       │       Query: bool { must: multi_match, filter: [tenant_id, is_deleted=false] }
       │       Fuzzy: fuzziness=AUTO when ?fuzzy=true
       │       Highlights: title + content snippets
       │       Aggregations: tag facets + author facets
       │       Term boost: title^3 (title matches ranked higher)
       │
       ├─► Redis.setex(key, 60s, result)   ← Cache result
       │
       └─► 200 Response { success: true, data: SearchResult, meta: { total, took, page } }
```

---

## Component Design Decisions

### Why Elasticsearch?
- **Inverted index**: Sub-millisecond text search on millions of documents
- **Horizontal scaling**: Shard-based architecture scales with data volume
- **Native relevance scoring**: BM25 algorithm, boost factors on title
- **Rich query DSL**: multi_match, fuzzy, highlighting, aggregations out of the box
- **vs. PostgreSQL FTS**: PG full-text search doesn't scale to 10M+ documents with <500ms at p95 across multiple indexes

### Why PostgreSQL (Prisma) as metadata store?
- **Source of truth**: Authoritative record of documents (not ES which is a search index)
- **Transactional deletes**: Soft delete with `deletedAt` timestamp ensures audit trail
- **Tenant metadata**: Rate limits, plan tiers, activation status
- **Relational integrity**: Tenant ↔ Document foreign key enforcement

### Why Redis?
- **Sub-millisecond cache**: Search result caching avoids repeated ES queries for popular searches
- **Sliding window rate limiting**: Redis sorted sets are ideal for ZREMRANGEBYSCORE-based sliding windows
- **Atomic operations**: Pipeline + EXPIRE ensures cache key management is atomic

---

## Multi-Tenancy Strategy

### Index-per-Tenant Isolation
- Each tenant gets a dedicated Elasticsearch index: `documents_{tenantId}`
- Queries never cross index boundaries → complete data isolation at the storage level
- Index-level security complements query-level filters (defense in depth)

### Query-Level Tenant Filters
- All Elasticsearch queries include a mandatory `filter: [{ term: { tenant_id: tenantId } }]`
- `is_deleted: false` filter prevents soft-deleted documents from appearing in results
- Tenant ID is extracted from validated middleware — never from user-controlled query params

### Database Scoping
- All Prisma queries include `WHERE tenantId = ?` scoping
- Repository methods accept `tenantId` as first parameter by convention — impossible to forget

---

## Caching Strategy

| Cache Type      | Key Pattern                          | TTL   | Invalidation                     |
|-----------------|--------------------------------------|-------|----------------------------------|
| Document cache  | `doc:{tenantId}:{docId}`            | 300s  | On update or delete              |
| Search cache    | `search:{tenantId}:{md5(queryStr)}` | 60s   | On any new document in tenant    |
| Health cache    | `health:status`                      | 10s   | Time-based expiry only           |

**Search invalidation** uses Redis SCAN to clear all matching keys when a document is modified.
This trades slight over-invalidation for correctness — search results during the window may be stale by 0 documents max.

---

## Consistency & Trade-offs

| Decision                              | Choice        | Trade-off                                           |
|---------------------------------------|---------------|-----------------------------------------------------|
| ES indexing failure on create         | Fail open     | Slight inconsistency; document exists in DB but not ES until re-indexed |
| Search cache TTL                      | 60 seconds    | Minor staleness vs. huge reduction in ES load       |
| Per-tenant ES index vs shared index   | Per-tenant    | More indices to manage; much better isolation       |
| Soft delete vs hard delete            | Soft delete   | Storage overhead; enables audit trail and recovery  |
| Rate limiter fail-open on Redis down  | Fail open     | Protects availability; small DDoS risk window       |
