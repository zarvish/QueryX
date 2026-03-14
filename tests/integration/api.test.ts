import request from 'supertest';
import express from 'express';

// Define base mock objects before imports through jest.mock factory
jest.mock('../../src/config/database', () => {
  const mockPrisma = {
    tenant: { findUnique: jest.fn() },
    document: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getPrismaClient: () => mockPrisma,
    createPrismaClient: () => mockPrisma,
    closePrismaClient: jest.fn(),
  };
});

jest.mock('../../src/config/elasticsearch', () => {
  const mockEs = {
    indices: { exists: jest.fn(), create: jest.fn() },
    index: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    cluster: { health: jest.fn() },
    search: jest.fn(),
  };
  return {
    getElasticsearchClient: () => mockEs,
    createElasticsearchClient: () => mockEs,
    closeElasticsearchClient: jest.fn(),
  };
});

jest.mock('../../src/config/redis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    scan: jest.fn(),
    ping: jest.fn(),
    pipeline: jest.fn().mockReturnValue({
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    }),
    zremrangebyscore: jest.fn(),
    zcard: jest.fn(),
    zadd: jest.fn(),
    expire: jest.fn(),
    quit: jest.fn(),
  };
  return {
    getRedisClient: () => mockRedis,
    createRedisClient: () => mockRedis,
    closeRedisClient: jest.fn(),
  };
});

// Now we can safely import them
import { getPrismaClient } from '../../src/config/database';
import { getElasticsearchClient } from '../../src/config/elasticsearch';
import { getRedisClient } from '../../src/config/redis';
import { createApp } from '../../src/app';

const mockPrisma = getPrismaClient() as any;
const mockEs = getElasticsearchClient() as any;
const mockRedis = getRedisClient() as any;

const activeTenant = {
  id: 'tenant-integration-test',
  name: 'Integration Test Tenant',
  isActive: true,
  rateLimit: 1000,
  plan: 'pro',
};

const mockDoc = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  tenantId: activeTenant.id,
  title: 'Integration Test Document',
  content: 'Integration test content',
  author: 'Tester',
  tags: ['test'],
  fileUrl: null,
  fileSize: null,
  mimeType: null,
  isDeleted: false,
  deletedAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

describe('API Integration Tests', () => {
  let app: express.Application;
  const TENANT_HEADER = 'x-tenant-id';

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default Prisma implementation
    mockPrisma.tenant.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === activeTenant.id) return Promise.resolve(activeTenant);
      return Promise.resolve(null);
    });
    mockPrisma.document.findFirst.mockResolvedValue(mockDoc);
    mockPrisma.document.create.mockResolvedValue(mockDoc);
    mockPrisma.document.update.mockResolvedValue({ ...mockDoc, title: 'Updated Title' });
    
    // Default ES implementation
    mockEs.indices.exists.mockResolvedValue(true);
    mockEs.indices.create.mockResolvedValue({});
    mockEs.index.mockResolvedValue({ result: 'created' });
    mockEs.update.mockResolvedValue({ result: 'updated' });
    mockEs.delete.mockResolvedValue({ result: 'deleted' });
    mockEs.cluster.health.mockResolvedValue({ status: 'green' });
    mockEs.search.mockResolvedValue({
      took: 3,
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [
          {
            _id: '550e8400-e29b-41d4-a716-446655440001',
            _score: 1.5,
            _source: {
              doc_id: '550e8400-e29b-41d4-a716-446655440001',
              title: 'Integration Test Document',
              content: 'Integration test content',
              author: 'Tester',
              tags: ['test'],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
            highlight: {
              title: ['<em>Integration</em> Test Document']
            }
          },
        ],
      },
      aggregations: {
        tags: { buckets: [{ key: 'test', doc_count: 1 }] },
        authors: { buckets: [{ key: 'Tester', doc_count: 1 }] },
      },
    });

    // Default Redis implementation
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.scan.mockResolvedValue(['0', []]);
    mockRedis.ping.mockResolvedValue('PONG');
    mockRedis.pipeline.mockReturnValue({
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
    });
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.quit.mockResolvedValue('OK');
  });

  // ─── Health Endpoint ─────────────────────────────────────────────
  describe('GET /health', () => {
    it('should return health status without authentication', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBeDefined();
      expect(res.body.data.dependencies).toBeDefined();
    });
  });

  // ─── Tenant Middleware ───────────────────────────────────────────
  describe('Tenant Middleware', () => {
    it('should return 401 when X-Tenant-ID header is missing', async () => {
      const res = await request(app).post('/documents').send({ title: 'Test' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TENANT_ERROR');
    });

    it('should return 401 for unknown tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/documents')
        .set(TENANT_HEADER, 'unknown-tenant')
        .send({ title: 'Test' });
      expect(res.status).toBe(401);
    });

    it('should return 401 for invalid tenant ID format', async () => {
      const res = await request(app)
        .post('/documents')
        .set(TENANT_HEADER, 'a!')
        .send({ title: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /documents ─────────────────────────────────────────────
  describe('POST /documents', () => {
    it('should create a document and return 201', async () => {
      const res = await request(app)
        .post('/documents')
        .set(TENANT_HEADER, activeTenant.id)
        .send({
          title: 'New Document',
          content: 'Test document content',
          author: 'Test Author',
          tags: ['test', 'integration'],
        });

      if (res.status !== 201) {
        console.error('Create doc failed:', res.body);
      }
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.meta.requestId).toBeDefined();
    });

    it('should return 400 for missing required title field', async () => {
      const res = await request(app)
        .post('/documents')
        .set(TENANT_HEADER, activeTenant.id)
        .send({ content: 'No title here' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── GET /documents/:id ──────────────────────────────────────────
  describe('GET /documents/:id', () => {
    it('should retrieve a document by ID', async () => {
      const res = await request(app)
        .get(`/documents/${mockDoc.id}`)
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(mockDoc.id);
    });

    it('should return 404 for non-existent document', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null);
      const res = await request(app)
        .get('/documents/550e8400-e29b-41d4-a716-446655440000')
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for invalid UUID format', async () => {
      const res = await request(app)
        .get('/documents/not-a-valid-uuid')
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /documents/:id ───────────────────────────────────────
  describe('DELETE /documents/:id', () => {
    it('should soft-delete a document', async () => {
      mockPrisma.document.update.mockResolvedValue({ ...mockDoc, isDeleted: true, deletedAt: new Date() });
      const res = await request(app)
        .delete(`/documents/${mockDoc.id}`)
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  // ─── PATCH /documents/:id ───────────────────────────────────────
  describe('PATCH /documents/:id', () => {
    it('should update document metadata', async () => {
      const res = await request(app)
        .patch(`/documents/${mockDoc.id}`)
        .set(TENANT_HEADER, activeTenant.id)
        .send({ title: 'Updated Title' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── GET /search ─────────────────────────────────────────────────
  describe('GET /search', () => {
    it('should return search results', async () => {
      const res = await request(app)
        .get('/search?q=integration+test')
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hits).toBeDefined();
      expect(res.body.meta.total).toBeDefined();
    });

    it('should return 400 when q parameter is missing', async () => {
      const res = await request(app)
        .get('/search')
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(400);
    });

    it('should return 404 for unregistered routes', async () => {
      const res = await request(app)
        .get('/unknown-route')
        .set(TENANT_HEADER, activeTenant.id);
      expect(res.status).toBe(404);
    });
  });
});
