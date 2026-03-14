import { z } from 'zod';

/**
 * Zod schema for creating a new document.
 */
export const createDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  content: z.string().max(1_000_000, 'Content too large').optional(),
  author: z.string().max(255).optional(),
  tags: z.array(z.string().max(100)).max(50, 'Too many tags').optional().default([]),
  fileUrl: z.string().url('Invalid file URL').optional(),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().max(100).optional(),
});

/**
 * Zod schema for updating an existing document.
 */
export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  author: z.string().max(255).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  fileUrl: z.string().url().optional(),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().max(100).optional(),
});

/**
 * Zod schema for document ID param.
 */
export const documentIdParamSchema = z.object({
  id: z.string().uuid('Invalid document ID'),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentIdParam = z.infer<typeof documentIdParamSchema>;
