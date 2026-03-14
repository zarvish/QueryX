/**
 * Seed Script — Creates 3 test tenants and 100 sample documents each.
 * Run: npx ts-node scripts/seed.ts
 * Requires: Running PostgreSQL + Elasticsearch + Redis (via docker-compose)
 */

import { PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';
import { v4 as uuidv4 } from 'uuid';

// Load env
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://queryx:queryx_secret@localhost:5432/queryx_db';
process.env['ELASTICSEARCH_URL'] = process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200';
process.env['ELASTICSEARCH_PASSWORD'] = process.env['ELASTICSEARCH_PASSWORD'] ?? 'queryx_elastic_secret';
process.env['ELASTICSEARCH_USERNAME'] = process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
process.env['LOG_LEVEL'] = 'info';
process.env['NODE_ENV'] = 'development';
process.env['RATE_LIMIT_WINDOW_MS'] = '60000';
process.env['RATE_LIMIT_MAX_REQUESTS'] = '100';
process.env['CACHE_SEARCH_TTL'] = '60';
process.env['CACHE_DOCUMENT_TTL'] = '300';
process.env['CACHE_HEALTH_TTL'] = '10';

const prisma = new PrismaClient();
const es = new Client({
  node: process.env['ELASTICSEARCH_URL'],
  auth: {
    username: process.env['ELASTICSEARCH_USERNAME'] ?? 'elastic',
    password: process.env['ELASTICSEARCH_PASSWORD'] ?? 'queryx_elastic_secret',
  },
});

const TENANTS = [
  { id: uuidv4(), name: 'Acme Corporation', plan: 'enterprise', rateLimit: 500 },
  { id: uuidv4(), name: 'StartupXYZ', plan: 'pro', rateLimit: 200 },
  { id: uuidv4(), name: 'FreeUser Inc', plan: 'free', rateLimit: 100 },
];

const TAGS_POOL = [
  'finance', 'hr', 'legal', 'engineering', 'marketing',
  'product', 'security', 'compliance', 'operations', 'research',
];

const AUTHORS = [
  'Alice Johnson', 'Bob Martinez', 'Carol White', 'David Lee',
  'Emma Davis', 'Frank Wilson', 'Grace Chen', 'Henry Brown',
];

const DOCUMENT_TEMPLATES = [
  { title: 'Q{n} Financial Report', content: 'This quarterly financial report covers revenue, expenses, and EBITDA for the period ending {date}. Key highlights include revenue growth of {p}% YoY and operating margin improvement.' },
  { title: 'Employee Handbook v{n}.0', content: 'This handbook outlines company policies, benefits, and procedures. Topics include remote work policy, code of conduct, performance review process, and employee benefits.' },
  { title: 'Security Policy {n}', content: 'Information security policy covering data classification, access control, incident response, and compliance requirements for SOC2 and ISO27001 frameworks.' },
  { title: 'Product Roadmap {n}', content: 'Strategic product roadmap for the next 12 months. Features planned include advanced analytics, API v3 with GraphQL support, mobile app improvements, and enterprise SSO.' },
  { title: 'Legal Agreement Template {n}', content: 'Standard master service agreement template for enterprise customers. Includes SLA commitments, data processing addendum, liability limitations, and termination clauses.' },
  { title: 'Engineering RFC {n}: Distributed Caching', content: 'Request for comments on implementing Redis Cluster for distributed caching. Proposes a cache-aside pattern with 5-minute TTL for frequently accessed data.' },
  { title: 'Marketing Campaign Brief {n}', content: 'Campaign brief for Q{n} product launch including target audience segmentation, channel strategy (SEO, PPC, social), budget allocation, and KPIs.' },
  { title: 'Incident Report {n}', content: 'Post-mortem report for incident affecting {p}% of users on {date}. Root cause: database connection pool exhaustion. Resolution: increased connection limits and added circuit breaker.' },
  { title: 'Compliance Audit Report {n}', content: 'GDPR compliance audit findings. All 47 data processing activities reviewed. 3 medium-risk items identified with remediation plans. Annual DPA review completed.' },
  { title: 'Research Paper: ML Pipeline {n}', content: 'Analysis of machine learning pipeline optimization techniques. Explores distributed training, feature engineering, model versioning, and A/B testing frameworks for production ML.' },
];

function buildIndexMapping(): object {
  return {
    mappings: {
      properties: {
        doc_id: { type: 'keyword' },
        tenant_id: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        content: { type: 'text', analyzer: 'standard' },
        author: { type: 'keyword' },
        tags: { type: 'keyword' },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
        is_deleted: { type: 'boolean' },
      },
    },
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  };
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomTags(): string[] {
  const count = Math.floor(Math.random() * 4) + 1;
  const shuffled = [...TAGS_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function ensureIndex(tenantId: string): Promise<string> {
  const sanitized = tenantId.toLowerCase().replace(/[^a-z0-9-_]/g, '_');
  const indexName = `documents_${sanitized}`;

  const exists = await es.indices.exists({ index: indexName });
  if (!exists) {
    await es.indices.create({ index: indexName, body: buildIndexMapping() });
    console.log(`✅ Created ES index: ${indexName}`);
  }

  return indexName;
}

async function seedTenant(
  tenant: (typeof TENANTS)[0],
  count = 100,
): Promise<void> {
  console.log(`\n📦 Seeding tenant: ${tenant.name} (${tenant.id})`);

  // Create tenant in DB
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    create: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      rateLimit: tenant.rateLimit,
      isActive: true,
    },
    update: { name: tenant.name },
  });

  const indexName = await ensureIndex(tenant.id);
  const bulkBody: object[] = [];

  for (let i = 1; i <= count; i++) {
    const template = DOCUMENT_TEMPLATES[(i - 1) % DOCUMENT_TEMPLATES.length] as { title: string; content: string };
    const tags = randomTags();
    const author = randomItem(AUTHORS);
    const createdAt = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);

    const title = template.title
      .replace('{n}', String(i))
      .replace('{p}', String(Math.floor(Math.random() * 30) + 5))
      .replace('{date}', createdAt.toISOString().split('T')[0] ?? '');

    const content = template.content
      .replace('{n}', String(i))
      .replace('{p}', String(Math.floor(Math.random() * 30) + 5))
      .replace('{date}', createdAt.toISOString().split('T')[0] ?? '');

    // Create in PostgreSQL
    const doc = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        title,
        content,
        author,
        tags,
        fileUrl: `https://s3.example.com/${tenant.id}/doc-${i}.pdf`,
        fileSize: Math.floor(Math.random() * 5_000_000) + 10_000,
        mimeType: 'application/pdf',
        createdAt,
        updatedAt: createdAt,
      },
    });

    // Add to ES bulk
    bulkBody.push({ index: { _index: indexName, _id: doc.id } });
    bulkBody.push({
      doc_id: doc.id,
      tenant_id: tenant.id,
      title,
      content,
      author,
      tags,
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      is_deleted: false,
    });

    if (i % 10 === 0) {
      process.stdout.write(`  📄 ${i}/${count} documents...\r`);
    }
  }

  // Bulk index in Elasticsearch
  const { errors } = await es.bulk({ body: bulkBody, refresh: true });

  if (errors) {
    console.error(`⚠️  Some ES bulk operations failed for tenant ${tenant.id}`);
  } else {
    console.log(`\n  ✅ ${count} documents indexed in Elasticsearch`);
  }
}

async function main(): Promise<void> {
  console.log('🌱 QueryX Seed Script Starting...\n');

  try {
    // Test connections
    await prisma.$connect();
    console.log('✅ PostgreSQL connected');

    await es.cluster.health({ timeout: '5s' });
    console.log('✅ Elasticsearch connected');

    for (const tenant of TENANTS) {
      await seedTenant(tenant, 100);
    }

    console.log('\n\n🎉 Seed complete!');
    console.log('\nTest tenant IDs:');
    TENANTS.forEach((t) => console.log(`  ${t.name}: ${t.id}`));
    console.log('\nUse these in your X-Tenant-ID header when testing.\n');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await es.close();
  }
}

main();
