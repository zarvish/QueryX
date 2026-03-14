import { DocumentService } from '../../src/modules/documents/document.service';
import { DocumentRepository } from '../../src/modules/documents/document.repository';

// Mock dependencies
const mockRepository = {
  create: jest.fn(),
  findById: jest.fn(),
  findByIdGlobal: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  listByTenant: jest.fn(),
} as unknown as DocumentRepository;

const mockEsClient = {
  indices: {
    exists: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockResolvedValue({}),
  },
  index: jest.fn().mockResolvedValue({ result: 'created' }),
  update: jest.fn().mockResolvedValue({ result: 'updated' }),
  delete: jest.fn().mockResolvedValue({ result: 'deleted' }),
} as unknown as import('@elastic/elasticsearch').Client;

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn().mockResolvedValue(['0', []]),
} as unknown as import('ioredis').default;

describe('DocumentService', () => {
  let service: DocumentService;

  const tenantId = 'tenant-123';
  const docId = 'doc-abc-123';

  const mockDocument = {
    id: docId,
    tenantId,
    title: 'Test Document',
    content: 'This is test content',
    author: 'John Doe',
    tags: ['finance', 'hr'],
    fileUrl: null,
    fileSize: null,
    mimeType: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentService(mockRepository, mockEsClient, mockRedis);
  });

  describe('createDocument', () => {
    it('should create a document and index in ES', async () => {
      (mockRepository.create as jest.Mock).mockResolvedValue(mockDocument);

      const input = {
        title: 'Test Document',
        content: 'This is test content',
        author: 'John Doe',
        tags: ['finance', 'hr'],
      };

      const result = await service.createDocument(tenantId, input);

      expect(mockRepository.create).toHaveBeenCalledWith(tenantId, {
        title: input.title,
        content: input.content,
        author: input.author,
        tags: input.tags,
        fileUrl: undefined,
        fileSize: undefined,
        mimeType: undefined,
      });

      expect(mockEsClient.index).toHaveBeenCalled();
      expect(result.id).toBe(docId);
      expect(result.tenantId).toBe(tenantId);
      expect(result.title).toBe('Test Document');
    });

    it('should still succeed if Elasticsearch indexing fails', async () => {
      (mockRepository.create as jest.Mock).mockResolvedValue(mockDocument);
      (mockEsClient.index as jest.Mock).mockRejectedValue(new Error('ES unavailable'));

      const input = { title: 'Test Document', tags: [] as string[] };
      const result = await service.createDocument(tenantId, input);

      expect(result.id).toBe(docId);
      // ES failure should not propagate
    });
  });

  describe('getDocument', () => {
    it('should return a cached document if available', async () => {
      const cachedDto = { id: docId, title: 'Cached Doc', tenantId };
      (mockRedis.get as jest.Mock).mockResolvedValue(JSON.stringify(cachedDto));

      const result = await service.getDocument(tenantId, docId);

      expect(result.id).toBe(docId);
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });

    it('should fetch from DB on cache miss and cache the result', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue(mockDocument);

      const result = await service.getDocument(tenantId, docId);

      expect(mockRepository.findById).toHaveBeenCalledWith(tenantId, docId);
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(result.id).toBe(docId);
    });

    it('should throw NotFoundError when document does not exist', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.getDocument(tenantId, docId)).rejects.toThrow('not found');
    });
  });

  describe('deleteDocument', () => {
    it('should soft-delete the document and invalidate cache', async () => {
      (mockRepository.softDelete as jest.Mock).mockResolvedValue({
        ...mockDocument,
        isDeleted: true,
        deletedAt: new Date(),
      });

      await service.deleteDocument(tenantId, docId);

      expect(mockRepository.softDelete).toHaveBeenCalledWith(tenantId, docId);
      expect(mockEsClient.update).toHaveBeenCalled();
    });
  });

  describe('updateDocument', () => {
    it('should update document in DB and ES', async () => {
      const updatedDoc = { ...mockDocument, title: 'Updated Title' };
      (mockRepository.update as jest.Mock).mockResolvedValue(updatedDoc);

      const result = await service.updateDocument(tenantId, docId, { title: 'Updated Title' });

      expect(mockRepository.update).toHaveBeenCalledWith(tenantId, docId, { title: 'Updated Title' });
      expect(result.title).toBe('Updated Title');
    });
  });
});
