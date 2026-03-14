import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { Document } from '@prisma/client';
import { DocumentRepository } from './document.repository';
import { CreateDocumentInput, UpdateDocumentInput } from './document.schema';
import { buildDocumentCacheKey, buildTenantIndexName, elapsedMs } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { NotFoundError } from '../../utils/errors';
import { EsDocument, DocumentDto } from '../../types';
import { config } from '../../config';

const ES_DOCUMENT_MAPPING = {
  mappings: {
    properties: {
      doc_id: { type: 'keyword' as const },
      tenant_id: { type: 'keyword' as const },
      title: { type: 'text' as const, analyzer: 'standard' },
      content: { type: 'text' as const, analyzer: 'standard' },
      author: { type: 'keyword' as const },
      tags: { type: 'keyword' as const },
      created_at: { type: 'date' as const },
      updated_at: { type: 'date' as const },
      is_deleted: { type: 'boolean' as const },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: '1s',
  },
};

/**
 * Service layer for document management.
 * Orchestrates between repository (PostgreSQL), Elasticsearch, and Redis cache.
 */
export class DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly esClient: Client,
    private readonly redis: Redis,
  ) {}

  /**
   * Ensures the Elasticsearch index for a tenant exists with proper mappings.
   */
  private async ensureTenantIndex(tenantId: string): Promise<void> {
    const indexName = buildTenantIndexName(tenantId);
    const exists = await this.esClient.indices.exists({ index: indexName });

    if (!exists) {
      await this.esClient.indices.create({
        index: indexName,
        body: ES_DOCUMENT_MAPPING,
      });
      logger.info({ tenantId, indexName }, 'Created Elasticsearch index for tenant');
    }
  }

  /**
   * Indexes a document in Elasticsearch.
   */
  private async indexInElasticsearch(tenantId: string, doc: Document): Promise<void> {
    const indexName = buildTenantIndexName(tenantId);

    const esDoc: EsDocument = {
      doc_id: doc.id,
      tenant_id: doc.tenantId,
      title: doc.title,
      content: doc.content ?? '',
      author: doc.author ?? '',
      tags: doc.tags,
      created_at: doc.createdAt.toISOString(),
      updated_at: doc.updatedAt.toISOString(),
      is_deleted: doc.isDeleted,
    };

    await this.esClient.index({
      index: indexName,
      id: doc.id,
      document: esDoc,
      refresh: 'wait_for',
    });

    logger.debug({ tenantId, docId: doc.id, indexName }, 'Document indexed in Elasticsearch');
  }

  /**
   * Removes a document from Elasticsearch (marks as deleted).
   */
  private async updateEsDeleted(tenantId: string, docId: string): Promise<void> {
    const indexName = buildTenantIndexName(tenantId);
    await this.esClient.update({
      index: indexName,
      id: docId,
      doc: { is_deleted: true },
    });
  }

  /**
   * Invalidates the document cache and search cache for this tenant.
   */
  private async invalidateCaches(tenantId: string, docId: string): Promise<void> {
    const docKey = buildDocumentCacheKey(tenantId, docId);

    // Delete document cache
    await this.redis.del(docKey);

    // Invalidate all search caches for this tenant using scan
    const pattern = `search:${tenantId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    logger.debug({ tenantId, docId }, 'Cache invalidated');
  }

  /**
   * Creates and indexes a new document for the given tenant.
   */
  async createDocument(tenantId: string, input: CreateDocumentInput): Promise<DocumentDto> {
    const start = process.hrtime.bigint();

    // Ensure ES index exists for this tenant
    await this.ensureTenantIndex(tenantId);

    // Store in PostgreSQL
    const doc = await this.repository.create(tenantId, {
      title: input.title,
      content: input.content,
      author: input.author,
      tags: input.tags ?? [],
      fileUrl: input.fileUrl,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    });

    // Index in Elasticsearch
    try {
      await this.indexInElasticsearch(tenantId, doc);
    } catch (err) {
      logger.error({ err, tenantId, docId: doc.id }, 'Failed to index document in ES');
      // Don't fail the request — ES indexing is async background concern
    }

    // Invalidate search caches for this tenant
    await this.invalidateCaches(tenantId, doc.id).catch((err) => {
      logger.warn({ err }, 'Cache invalidation failed');
    });

    logger.info(
      { tenantId, docId: doc.id, took: Math.round(elapsedMs(start)) },
      'Document created',
    );

    return this.toDto(doc);
  }

  /**
   * Retrieves a document by ID for the given tenant, using cache-aside pattern.
   */
  async getDocument(tenantId: string, id: string): Promise<DocumentDto> {
    const cacheKey = buildDocumentCacheKey(tenantId, id);

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      logger.debug({ tenantId, docId: id }, 'Document cache HIT');
      return JSON.parse(cached) as DocumentDto;
    }

    logger.debug({ tenantId, docId: id }, 'Document cache MISS');

    const doc = await this.repository.findById(tenantId, id);
    if (!doc) {
      throw new NotFoundError(`Document '${id}' not found`);
    }

    const dto = this.toDto(doc);

    // Cache the result
    await this.redis.setex(cacheKey, config.CACHE_DOCUMENT_TTL, JSON.stringify(dto));

    return dto;
  }

  /**
   * Soft-deletes a document and removes it from search results.
   */
  async deleteDocument(tenantId: string, id: string): Promise<void> {
    const doc = await this.repository.softDelete(tenantId, id);

    // Mark as deleted in ES
    try {
      await this.updateEsDeleted(tenantId, id);
    } catch (err) {
      logger.error({ err, tenantId, docId: id }, 'Failed to update ES deletion flag');
    }

    // Invalidate caches
    await this.invalidateCaches(tenantId, doc.id).catch((err) => {
      logger.warn({ err }, 'Cache invalidation failed');
    });

    logger.info({ tenantId, docId: id }, 'Document soft-deleted');
  }

  /**
   * Updates document metadata in both PostgreSQL and Elasticsearch.
   */
  async updateDocument(
    tenantId: string,
    id: string,
    input: UpdateDocumentInput,
  ): Promise<DocumentDto> {
    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData['title'] = input.title;
    if (input.author !== undefined) updateData['author'] = input.author;
    if (input.tags !== undefined) updateData['tags'] = input.tags;
    if (input.fileUrl !== undefined) updateData['fileUrl'] = input.fileUrl;
    if (input.fileSize !== undefined) updateData['fileSize'] = input.fileSize;
    if (input.mimeType !== undefined) updateData['mimeType'] = input.mimeType;

    const doc = await this.repository.update(tenantId, id, updateData);

    // Update in Elasticsearch
    try {
      const indexName = buildTenantIndexName(tenantId);
      await this.esClient.update({
        index: indexName,
        id: doc.id,
        doc: {
          title: doc.title,
          author: doc.author ?? '',
          tags: doc.tags,
          updated_at: doc.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err, tenantId, docId: id }, 'Failed to update ES document');
    }

    // Invalidate caches
    await this.invalidateCaches(tenantId, doc.id).catch((err) => {
      logger.warn({ err }, 'Cache invalidation failed');
    });

    logger.info({ tenantId, docId: id }, 'Document updated');
    return this.toDto(doc);
  }

  /**
   * Maps a Prisma Document to a DocumentDto for API responses.
   */
  private toDto(doc: Document): DocumentDto {
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      title: doc.title,
      content: doc.content ?? undefined,
      fileUrl: doc.fileUrl ?? undefined,
      fileSize: doc.fileSize ?? undefined,
      mimeType: doc.mimeType ?? undefined,
      author: doc.author ?? undefined,
      tags: doc.tags,
      isDeleted: doc.isDeleted,
      deletedAt: doc.deletedAt ?? undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
