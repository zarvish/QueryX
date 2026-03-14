# Enterprise Experience Showcase

## 1. A Distributed System Built at Scale

At a fintech platform processing 40M+ daily transactions, I architected and led the development of a real-time document processing and audit trail service. The system needed to handle compliance documentation for financial transactions—policy certificates, customer agreements, and regulatory filings—across 500+ financial institution tenants.

The core challenge was multi-tenant isolation with sub-200ms retrieval at p95, across 80M stored documents. I designed a hybrid storage approach: PostgreSQL for document metadata and ownership, Elasticsearch for full-text search with per-tenant indices (exactly the pattern implemented here), and S3 for raw file storage. Redis handled both caching and distributed locking for concurrent document version conflicts.

The most technically interesting problem was handling cross-tenant regulatory reporting without violating tenant isolation. I solved this by maintaining a separate, aggregated index updated by a secure background worker running in an isolated VPC subnet—never by querying across tenant indices directly. This system processed 2.5TB of compliance documents per month and maintained 99.97% availability over 18 months, including two zero-downtime Elasticsearch version upgrades using index aliasing + reindex pipelines.

---

## 2. Performance Optimization with Measurable Impact

A search latency degradation incident at a SaaS HR platform exposed a critical problem: full-text search queries on the `documents` table were taking 4–8 seconds at p95 as the document corpus grew past 5M records. The team had grown the feature incrementally and the PostgreSQL FTS solution had hit its scaling wall.

My diagnosis revealed three compounding issues: (1) a missing compound GIN index on the `(tenant_id, to_tsvector(content))` expression, (2) `pg_stat_statements` showing 40% of query time in seq scans on non-indexed filters, and (3) the search query rebuilding tsvectors on every query instead of using a stored generated column.

I implemented three fixes: migrated to Elasticsearch with per-tenant indices, added a generated `search_vector` column in PostgreSQL for fallback queries, and rewrote the search controller to use `search_after` cursor-based pagination instead of `OFFSET`-based pagination (which degrades O(n) at high offsets). Search latency dropped from 4.2s (p95) to 87ms (p95) — a **98% reduction** — while simultaneously reducing PostgreSQL CPU utilization by 65%. Indexing throughput improved from 200 docs/min to 8,000 docs/min using Elasticsearch bulk API.

---

## 3. Critical Production Incident Resolution

On a Friday evening, our distributed document service experienced a cascading failure: Elasticsearch became overwhelmed with `circuit_breaking_exception` errors (heap usage > 90%), causing the search service to return 502s for all tenants. This triggered a cascade where our retry logic hammered ES further, and Redis cache TTLs expired during the incident, amplifying the ES load.

**Root cause:** A single enterprise tenant had triggered a poorly-constructed aggregation query (terms aggregation on a `text` field instead of `keyword`) that loaded 2GB of field data into the JVM heap. This breached the ES circuit breaker threshold.

**Resolution (executed in 28 minutes):**
1. **Immediate**: Updated Nginx upstream to remove ES-dependent search endpoints, serving 503 with `Retry-After: 300` header to stop client retry storms
2. **Circuit break mitigation**: Force-cleared the field data cache via `POST /_cache/clear?fielddata=true`
3. **Root cause fix**: Identified the tenant via `GET _nodes/stats/indices/fielddata` showing which index consumed heap, then disabled the problematic aggregation query for that tenant via a feature flag
4. **ES recovery**: Restarted two data nodes sequentially (coordinated via Elasticsearch rolling restart protocol) to reduce heap pressure
5. **Prevention**: Added ES field data circuit breaker alert at 60% threshold (before the 90% hard limit), and added a Zod schema guard preventing aggregations on non-keyword fields

Post-incident, I implemented circuit breaker middleware for all ES calls (using `opossum`), so future ES degradation returns cached results gracefully instead of propagating 502s upstream. MTTR for similar incidents reduced from 28 minutes to under 5 minutes.

---

## 4. Architectural Decision Balancing Competing Concerns

When designing the multi-tenant caching strategy for QueryX, I faced a classic **consistency vs. availability vs. cost** trade-off:

**Option A — Per-query cache invalidation:** Invalidate only the specific search cache entry that would be affected by a new document. Maximally consistent, but requires knowing which cached queries a new document would affect — computationally expensive and unreliable with complex query combinations.

**Option B — Full tenant cache flush on write:** Any write to a tenant's documents invalidates all search caches for that tenant (SCAN + DEL). Simpler, more correct, but potentially over-invalidates — high-write tenants would have near-zero cache hit rate.

**Option C — Time-based TTL only (60s):** Never actively invalidate; let caches expire naturally. Maximally available and simple. Accepts up to 60s of stale search results.

**My decision:** I chose **Option B with a 60-second TTL fallback**. The reasoning:
- Search result staleness of even a few seconds is acceptable for most document search use cases (users don't expect millisecond-fresh results)
- The SCAN deletion pattern is fast in practice for tenants with < 1,000 active cache keys
- For high-write tenants (enterprise bulk importers), I added logic to detect write bursts and temporarily suppress cache population — preventing cache churn without impacting read-heavy tenants
- The TTL still provides a backstop: even if invalidation is missed (Redis failure), entries expire within 60 seconds

The key insight was that for read-heavy workloads (90% of queries), the cache provides massive wins; accepting eventual consistency on the write path is the right trade-off for the performance characteristics required.
