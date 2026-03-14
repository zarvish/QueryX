## Enterprise Experience Showcase

### 1. Distributed System Built in Production

I built a content automation platform designed to collect, process, and publish news content from multiple sources including Google News, LiveLaw, and social media platforms. The system uses a distributed pipeline consisting of web scraping workers, OCR extraction using Pytesseract, AI-based content generation using LLM APIs, and automated publishing workflows. Apache Airflow orchestrates scheduled ETL pipelines while BullMQ manages background processing jobs and task queues.

The system was designed to handle continuous content ingestion and processing while preventing duplicate content. To achieve this, I implemented cosine similarity detection using the all-MiniLM-L6-v2 embedding model to identify semantically similar articles before publishing. This architecture allowed scraping, processing, and publishing to run independently and asynchronously, improving reliability and enabling the system to scale across multiple content sources without blocking the main application.

---

### 2. Performance Optimization

While building an AI-powered voice assistant platform that handled real-time phone conversations, I encountered performance challenges due to the sequential processing pipeline involving speech-to-text transcription, language model reasoning, and text-to-speech generation.

To reduce latency, I redesigned the pipeline to support streaming and parallel processing where possible. Audio transcription results were streamed incrementally instead of waiting for the full transcript, allowing the language model request to start earlier. I also maintained persistent WebSocket connections for real-time audio streaming and removed blocking API calls that previously serialized parts of the pipeline.

Additionally, I reduced unnecessary data transformations between services and reused existing connections for external APIs instead of opening new ones per request. These optimizations significantly reduced the end-to-end response latency and allowed the system to maintain conversational response times around ~1.2 seconds while supporting multiple concurrent calls.

---

### 3. Critical Production Incident Resolution

During development of the AI voice assistant platform, we experienced intermittent call failures caused by timeouts from external AI and speech-processing APIs. When these timeouts occurred, the conversation pipeline would sometimes terminate early, causing incomplete responses to callers.

I addressed the issue by implementing retry mechanisms, improving error handling across service boundaries, and introducing fallback responses to ensure the conversation could continue even if certain external services temporarily failed. I also added structured logging and better tracing to identify failure points in the distributed pipeline. These changes significantly improved system reliability and made production debugging far easier.

---

### 4. Architectural Decision Balancing Competing Concerns

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
