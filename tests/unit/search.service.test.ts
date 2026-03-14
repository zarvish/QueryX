import { SearchService } from '../../src/modules/search/search.service';
import { SearchQuery } from '../../src/modules/search/search.schema';

const mockEsResponse = {
  took: 5,
  timed_out: false,
  hits: {
    total: { value: 2, relation: 'eq' },
    hits: [
      {
        _id: 'doc1',
        _score: 1.5,
        _source: {
          doc_id: 'doc1',
          title: 'Quarterly Finance Report',
          content: 'Q4 finance report with ...',
          author: 'alice',
          tags: ['finance'],
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
        highlight: {
          title: ['<em>Finance</em> Report'],
          content: ['Q4 <em>finance</em> report'],
        },
      },
      {
        _id: 'doc2',
        _score: 1.0,
        _source: {
          doc_id: 'doc2',
          title: 'HR Policy',
          content: 'Human resources policy document',
          author: 'bob',
          tags: ['hr'],
          created_at: '2024-01-10T08:00:00Z',
          updated_at: '2024-01-10T08:00:00Z',
        },
        highlight: undefined,
      },
    ],
  },
  aggregations: {
    tags: {
      buckets: [
        { key: 'finance', doc_count: 1 },
        { key: 'hr', doc_count: 1 },
      ],
    },
    authors: {
      buckets: [
        { key: 'alice', doc_count: 1 },
        { key: 'bob', doc_count: 1 },
      ],
    },
  },
};

const mockEsClient = {
  search: jest.fn().mockResolvedValue(mockEsResponse),
} as unknown as import('@elastic/elasticsearch').Client;

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
} as unknown as import('ioredis').default;

describe('SearchService', () => {
  let service: SearchService;

  const tenantId = 'tenant-123';

  const baseQuery: SearchQuery = {
    q: 'finance report',
    tenant: tenantId,
    page: 1,
    limit: 10,
    fuzzy: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SearchService(mockEsClient, mockRedis);
  });

  describe('search', () => {
    it('should return search results with hits and facets', async () => {
      const result = await service.search(tenantId, baseQuery);

      expect(result.hits).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.facets?.tags).toHaveLength(2);
      expect(result.facets?.authors).toHaveLength(2);
    });

    it('should check Redis cache before calling Elasticsearch', async () => {
      const cachedResult = { hits: [], total: 0, page: 1, limit: 10, took: 1 };
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(cachedResult));

      const result = await service.search(tenantId, baseQuery);

      expect(mockEsClient.search).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
    });

    it('should cache search results after a cache miss', async () => {
      await service.search(tenantId, baseQuery);

      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return empty results when index does not exist', async () => {
      (mockEsClient.search as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('index_not_found_exception'), {
          meta: { statusCode: 404 },
        }),
      );

      const result = await service.search(tenantId, baseQuery);

      expect(result.hits).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should include highlight snippets in results', async () => {
      const result = await service.search(tenantId, baseQuery);

      const firstHit = result.hits[0];
      expect(firstHit?.highlights?.title).toContain('<em>Finance</em> Report');
    });

    it('should throw SearchError for unexpected ES failures', async () => {
      (mockEsClient.search as jest.Mock).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(service.search(tenantId, baseQuery)).rejects.toThrow('Search failed');
    });
  });
});
