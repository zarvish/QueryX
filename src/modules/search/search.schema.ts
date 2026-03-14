import { z } from 'zod';

/**
 * Zod schema for search query parameters.
 */
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Query string is required').max(500, 'Query too long'),
  tenant: z.string().min(3).max(64),
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('10').transform((v) => Math.min(Number(v), 100)),
  tags: z.string().optional(),
  author: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  fuzzy: z.string().optional().transform((v) => v === 'true'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
