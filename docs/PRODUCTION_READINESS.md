# Production Readiness Analysis

## Scalability

### Handling 100x Growth

> **Note:** The current implementation represents a simplified prototype.  
> The following sections outline how the system architecture would evolve for production-scale deployments, focusing on scalability, resilience, security, and operational maturity.

**Document volume (10M → 1B documents):**
- Shard Elasticsearch horizontally: increase `number_of_shards` per index, or introduce an index alias strategy with time-based indices (ILM)
- Move to Elasticsearch cluster with dedicated master, data, and coordinator nodes
- Introduce index rollover using Elasticsearch ILM policies to cap index size at ~50GB/shard
- For higher scale deployments, an event-driven indexing pipeline using Kafka or a similar message queue can decouple writes from search indexing.

**Traffic volume (1K → 100K req/s):**
- Horizontal API scaling behind Nginx/cloud load balancer (stateless instances trivially scalable)
- Redis Cluster for distributed caching (consistent hashing across multiple Redis nodes)
- PostgreSQL read replicas for metadata reads; write to primary, read from replicas
- Cross-region deployments could use read replicas or globally distributed databases depending on latency requirements.

**Per-tenant index sprawl (1000+ tenants):**
- Implement tenant-based index aliasing: group small tenants into shared indices with mandatory routing
- Enterprise tenants get dedicated indices; free/pro tenants share partitioned indices
- Background ILM job purges indices for inactive tenants

---

## Resilience

### Circuit Breakers
- Implement circuit breaker pattern (e.g., `opossum` library) around Elasticsearch and Redis clients
- States: CLOSED (normal) → OPEN (failing fast) → HALF-OPEN (testing recovery)
- If ES is unavailable, return degraded search from PostgreSQL FTS fallback

### Retry Strategies
- Elasticsearch client: configured with `maxRetries: 3`, exponential backoff (100ms, 200ms, 400ms)
- Redis client: `retryStrategy` with `min(times * 100ms, 3s)` cap
- Failed ES indexing: publish to a dead-letter queue (Redis List or Kafka DLQ), background worker retries

### Failover
- Multi-AZ Elasticsearch cluster: 3 master nodes (quorum), data nodes in separate AZs
- PostgreSQL HA with automatic failover (AWS RDS Multi-AZ or Patroni on-prem)
- Redis Sentinel or Redis Cluster for automatic Redis leader election
- Rate limiter fails open if Redis is unreachable (availability over consistency trade-off)

---

## Security

### Authentication & Authorization
- Current prototype uses X-Tenant-ID as simplified auth (adequate for assessment)
- Production: OAuth2/OIDC with JWT bearer tokens (Auth0, Keycloak, or custom issuer)
- JWT payload: `{ sub: userId, tenantId, scopes: ['docs:read', 'docs:write'] }`
- Role-based access: tenant admins can configure rate limits; read-only users cannot index
- API key issuing for server-to-server integration (rotate via secret management)

### Encryption
- **In transit**: TLS 1.3 enforced at load balancer; Elasticsearch HTTPS enabled in production
- **At rest**: AWS EBS/EFS encryption with KMS managed keys for all persistence volumes
- **Document content**: PII documents should be client-side encrypted before indexing; search on encrypted content requires tokenized search tokens
- **Redis**: TLS-enabled Redis (ElastiCache with TLS) for sensitive cached data

### API Security
- Helmet.js headers (already implemented): Content-Security-Policy, X-Frame-Options, etc.
- Request body size limits (10MB cap on JSON — already implemented)
- Rate limiting per tenant prevents abuse (already implemented)
- Input validation with Zod on every endpoint (already implemented)
- Never log request body content (implemented via Pino `redact`)
- CORS policy: restrict to known frontend origins in production (currently `*` for development)

---

## Observability

### Metrics (Production Additions)
- Expose a `/metrics` endpoint with Prometheus format using `prom-client`
- Key metrics to track:
  - `queryx_http_request_duration_ms` (p50, p95, p99 by route)
  - `queryx_cache_hits_total` / `queryx_cache_misses_total` (by type)
  - `queryx_elasticsearch_query_duration_ms` (by tenant bucket)
  - `queryx_rate_limit_exceeded_total` (by tenant)
  - `queryx_documents_indexed_total` (by tenant)
- Grafana dashboard with SLO burn rate alerts

### Logging
- Structured JSON logging via Pino (already implemented)
- Log aggregation: forward to Elasticsearch Logstash pipeline or Datadog/Loki
- Correlation IDs across service boundaries (`X-Request-ID` header propagation)
- Log sampling for debug-level logs in production (1% sampling to control volume)

### Distributed Tracing
- Instrument with OpenTelemetry SDK
- Trace: inbound request → middleware chain → ES query → Redis cache → response
- Export to Jaeger (self-hosted) or Datadog APM
- Auto-instrument Express and `@elastic/elasticsearch` with OTel auto-instrumentation

### Alerting
- PagerDuty integration for critical alerts:
  - p95 search latency > 500ms (SLO breach warning)
  - Error rate > 1% over 5 minutes
  - Elasticsearch cluster health RED
  - Redis connection failures > 3 in 60 seconds
  - Any 5xx rate > 0.1%

---

## Performance Optimizations

### Elasticsearch Index Management
- **Mapping**: All fields explicitly mapped (no dynamic mapping drift)
- **Refresh interval**: 1 second (near-real-time without penalizing write throughput)
- **Shard sizing**: Target 20-50GB per shard for optimal JVM heap usage
- **Field data caching**: Increase `indices.fielddata.cache.size` for faceted aggregations
- **Index sorting**: Sort by `_score` and `created_at` at index creation for efficient top-N queries

### Query Optimization
- `search_after` pagination instead of `from/size` for deep pagination (avoid OOM on large offsets)
- Filter caching: ES automatically caches filter clause results (tenant_id, is_deleted filters hit cache on repeated queries)
- Source filtering: only retrieve needed fields in `_source` to reduce network payload
- Async indexing for bulk operations to avoid blocking write path

### Database Optimization
- Index on `(tenantId, isDeleted)` composite — already defined in Prisma schema
- Connection pooling: use `pg-pool` or PgBouncer in front of PostgreSQL
- Read replicas: route GET queries to replicas
- Materialized views for tenant usage statistics (document counts, storage usage)

---

## Operations

### Zero-Downtime Deployment
- Blue-green deployment implemented in `docker-compose.prod.yml`
- Process:
  1. Deploy new image to green instances
  2. Health check green until healthy
  3. Shift Nginx upstream to green (single config reload)
  4. Monitor error rates for 5 minutes
  5. Terminate blue instances if stable; rollback if error rate spikes
- Database migrations: run `prisma migrate deploy` before traffic shift (additive migrations only)
- ES mapping changes: use index aliasing + reindex to avoid downtime

### Backup & Recovery
- **PostgreSQL**: Automated daily snapshots (AWS RDS automated backups, 30-day retention); WAL-based point-in-time recovery
- **Elasticsearch**: Elasticsearch Snapshot API to S3 repository (daily snapshots, 7-day retention)
- **Redis**: AOF persistence enabled (`appendonly yes`); daily RDB snapshots to S3; Redis is **not** source of truth — can be rebuilt from Postgres + ES
- **Recovery objectives**: RTO < 1 hour, RPO < 1 day for data loss; cache warmup may cause temporary latency spike

---

## SLA: 99.95% Availability

**Achieving 99.95% (~4.4 hours downtime/year):**

| Layer                | Strategy                                           | Contribution |
|----------------------|----------------------------------------------------|--------------|
| API layer            | Multiple instances, health-check based routing     | 99.99%       |
| PostgreSQL           | Multi-AZ with auto-failover (< 30s)               | 99.95%       |
| Elasticsearch        | 3-node cluster, cross-AZ shards                   | 99.9%        |
| Redis                | Redis Sentinel with auto-failover                  | 99.99%       |
| Maintenance windows  | Zero-downtime blue-green + rolling deployments     | 99.9%        |

**Error budget**: With 99.95% target, 2.6 minutes/week error budget. Enforce with:
- Request timeout per call: 10s ES timeout, 5s Redis timeout
- Rate limiting prevents cascade failures from traffic spikes
- Circuit breakers stop cascades when a dependency degrades

---

## Cost Optimization

### Cloud Architecture Choices
- **Elasticsearch**: Use AWS OpenSearch or Elastic Cloud to avoid self-managing ES clusters
- **RDS PostgreSQL**: Use reserved 1-year instances (40-60% savings vs. on-demand)
- **Redis**: ElastiCache with reserved nodes; use Redis Cluster only when needed (avoid over-provisioning)
- **API instances**: Spot instances for stateless API nodes (can tolerate interrupts gracefully via SIGTERM handler already implemented)
- **Storage tiers**: Move old ES indices to warm/cold tier (S3-backed) using Elasticsearch ILM — reduces cost by 80% for infrequently searched historical documents

### Index-Level Cost Control
- Compress stored `_source` fields in ES (`best_compression` codec)
- Disable `_source` storage for content field (only index, not stored; retrieve from Postgres on-demand)
- TTL-based document expiry using ILM delete phase for compliance with data retention policies
