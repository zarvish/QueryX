/**
 * Benchmark Script — Performance load test.
 * Indexes 1000 documents then runs 100 concurrent searches.
 * Reports p50, p95, p99 latencies.
 *
 * Run: npx ts-node scripts/benchmark.ts
 * Prereq: Services must be running (docker-compose up)
 */

import { PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';
import { v4 as uuidv4 } from 'uuid';

process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://queryx:queryx_secret@localhost:5432/queryx_db';
process.env['ELASTICSEARCH_URL'] = process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200';
process.env['ELASTICSEARCH_PASSWORD'] = process.env['ELASTICSEARCH_PASSWORD'] ?? 'queryx_elastic_secret';
process.env['ELASTICSEARCH_USERNAME'] = process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
process.env['LOG_LEVEL'] = 'error'; // Suppress logs during benchmark
process.env['NODE_ENV'] = 'production';
process.env['RATE_LIMIT_WINDOW_MS'] = '60000';
process.env['RATE_LIMIT_MAX_REQUESTS'] = '10000';
process.env['CACHE_SEARCH_TTL'] = '60';
process.env['CACHE_DOCUMENT_TTL'] = '300';
process.env['CACHE_HEALTH_TTL'] = '10';
process.env['PORT'] = '3001';

const API_BASE = process.env['BENCHMARK_API_URL'] ?? 'http://localhost:3000';

interface BenchmarkStats {
  operation: string;
  totalRequests: number;
  successCount: number;
  failCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  throughputRps: number;
  totalDurationMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function computeStats(
  operation: string,
  latencies: number[],
  errors: number,
  totalMs: number,
): BenchmarkStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  return {
    operation,
    totalRequests: latencies.length + errors,
    successCount: latencies.length,
    failCount: errors,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    p99Ms: Math.round(percentile(sorted, 99)),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    avgMs: Math.round(avg),
    throughputRps: Math.round((latencies.length / totalMs) * 1000),
    totalDurationMs: totalMs,
  };
}

function printStats(stats: BenchmarkStats): void {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${stats.operation}`);
  console.log('═'.repeat(55));
  console.log(`  Total:       ${stats.totalRequests} requests`);
  console.log(`  Success:     ${stats.successCount}`);
  console.log(`  Errors:      ${stats.failCount}`);
  console.log(`  Duration:    ${stats.totalDurationMs}ms`);
  console.log(`  Throughput:  ${stats.throughputRps} req/s`);
  console.log('  ─'.repeat(28));
  console.log(`  p50:         ${stats.p50Ms}ms`);
  console.log(`  p95:         ${stats.p95Ms}ms`);
  console.log(`  p99:         ${stats.p99Ms}ms`);
  console.log(`  min:         ${stats.minMs}ms`);
  console.log(`  max:         ${stats.maxMs}ms`);
  console.log(`  avg:         ${stats.avgMs}ms`);
  console.log('═'.repeat(55));
}

async function timedFetch(
  url: string,
  options: RequestInit,
): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(url, options);
    return { ok: response.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function benchmarkIndexing(
  tenantId: string,
  count = 1000,
): Promise<BenchmarkStats> {
  console.log(`\n🔷 Benchmark: Indexing ${count} documents...`);
  const latencies: number[] = [];
  let errors = 0;
  const batchSize = 10;

  const start = Date.now();

  for (let i = 0; i < count; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - i) }, (_, j) => ({
      title: `Benchmark Document ${i + j + 1} - ${uuidv4()}`,
      content: `Performance test document ${i + j + 1}. Contains realistic content for benchmarking purposes. Keywords: search, indexing, elasticsearch, distributed, performance.`,
      author: ['Alice', 'Bob', 'Carol', 'Dave'][Math.floor(Math.random() * 4)] as string,
      tags: [['finance', 'hr'][Math.floor(Math.random() * 2)] as string, 'benchmark'],
    }));

    const results = await Promise.all(
      batch.map((doc) =>
        timedFetch(`${API_BASE}/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
          },
          body: JSON.stringify(doc),
        }),
      ),
    );

    results.forEach(({ ok, latencyMs }) => {
      if (ok) latencies.push(latencyMs);
      else errors++;
    });

    if ((i + batchSize) % 100 === 0) {
      process.stdout.write(`  Progress: ${Math.min(i + batchSize, count)}/${count}\r`);
    }
  }

  const totalMs = Date.now() - start;
  return computeStats(`Indexing (${count} documents)`, latencies, errors, totalMs);
}

async function benchmarkSearch(
  tenantId: string,
  concurrentRequests = 100,
): Promise<BenchmarkStats> {
  console.log(`\n🔷 Benchmark: ${concurrentRequests} concurrent searches...`);

  const queries = ['finance', 'report', 'policy', 'security', 'engineering', 'performance', 'benchmark', 'document'];
  const latencies: number[] = [];
  let errors = 0;

  const start = Date.now();

  const batches = [];
  const batchSize = 20;

  for (let i = 0; i < concurrentRequests; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, concurrentRequests - i) }, (_, j) => {
      const q = queries[(i + j) % queries.length] as string;
      return timedFetch(`${API_BASE}/search?q=${encodeURIComponent(q)}&page=1&limit=10`, {
        method: 'GET',
        headers: { 'x-tenant-id': tenantId },
      });
    });

    const results = await Promise.all(batch);
    results.forEach(({ ok, latencyMs }) => {
      if (ok) latencies.push(latencyMs);
      else errors++;
    });

    batches.push(results.length);
  }

  const totalMs = Date.now() - start;
  return computeStats(`Search (${concurrentRequests} concurrent)`, latencies, errors, totalMs);
}

async function main(): Promise<void> {
  console.log('⚡ QueryX Performance Benchmark');
  console.log(`   API: ${API_BASE}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Create benchmark tenant
  const tenantId = `benchmark-${uuidv4().slice(0, 8)}`;

  // Create tenant via API isn't possible (no tenant CRUD), so we use Prisma directly
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  try {
    await prisma.$connect();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Benchmark Tenant',
        plan: 'enterprise',
        rateLimit: 10000,
        isActive: true,
      },
    });
    console.log(`✅ Benchmark tenant created: ${tenantId}`);
  } catch (err) {
    console.warn('Could not create benchmark tenant via Prisma:', (err as Error).message);
    console.warn('Make sure the API is running and DB is accessible.');
    await prisma.$disconnect();
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  // Run benchmarks
  const indexStats = await benchmarkIndexing(tenantId, 1000);
  printStats(indexStats);

  // Wait for ES to index
  console.log('\n⏳ Waiting 3s for Elasticsearch refresh...');
  await new Promise((r) => setTimeout(r, 3000));

  const searchStats = await benchmarkSearch(tenantId, 100);
  printStats(searchStats);

  console.log('\n✅ Benchmark complete!');
  console.log('\nSLA Check:');
  console.log(`  p95 search latency: ${searchStats.p95Ms}ms ${searchStats.p95Ms < 500 ? '✅ (< 500ms target)' : '❌ (> 500ms target)'}`);
  console.log(`  p99 search latency: ${searchStats.p99Ms}ms`);
  console.log(`  Search throughput: ${searchStats.throughputRps} req/s\n`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
