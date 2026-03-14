import { PrismaClient, Document, Prisma } from '@prisma/client';
import { NotFoundError } from '../../utils/errors';

/**
 * Repository layer — all database operations for documents.
 * Controllers and services must not use Prisma directly.
 */
export class DocumentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new document record in the database.
   */
  async create(
    tenantId: string,
    data: {
      title: string;
      content?: string;
      author?: string;
      tags: string[];
      fileUrl?: string;
      fileSize?: number;
      mimeType?: string;
    },
  ): Promise<Document> {
    return this.prisma.document.create({
      data: {
        tenantId,
        title: data.title,
        content: data.content,
        author: data.author ?? null,
        tags: data.tags,
        fileUrl: data.fileUrl ?? null,
        fileSize: data.fileSize ?? null,
        mimeType: data.mimeType ?? null,
      },
    });
  }

  /**
   * Finds a document by ID, scoped to the given tenant.
   * Returns null if not found or belongs to another tenant.
   */
  async findById(tenantId: string, id: string): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: {
        id,
        tenantId,
        isDeleted: false,
      },
    });
  }

  /**
   * Finds a document by ID without tenant scope — used internally.
   */
  async findByIdGlobal(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { id } });
  }

  /**
   * Updates document metadata. Always scoped to tenantId.
   * Throws NotFoundError if document doesn't exist for this tenant.
   */
  async update(
    tenantId: string,
    id: string,
    data: Prisma.DocumentUpdateInput,
  ): Promise<Document> {
    const existing = await this.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Document with id '${id}' not found`);
    }

    return this.prisma.document.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Soft-deletes a document. Sets isDeleted=true, records deletedAt timestamp.
   * Throws NotFoundError if document doesn't exist for this tenant.
   */
  async softDelete(tenantId: string, id: string): Promise<Document> {
    const existing = await this.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`Document with id '${id}' not found`);
    }

    return this.prisma.document.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Lists documents for a tenant with pagination.
   */
  async listByTenant(
    tenantId: string,
    opts: { skip: number; take: number },
  ): Promise<{ documents: Document[]; total: number }> {
    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where: { tenantId, isDeleted: false },
        skip: opts.skip,
        take: opts.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({
        where: { tenantId, isDeleted: false },
      }),
    ]);

    return { documents, total };
  }
}
