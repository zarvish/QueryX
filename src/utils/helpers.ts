import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a new UUID v4 request identifier.
 */
export function generateRequestId(): string {
  return uuidv4();
}

/**
 * Creates an MD5 hash of a string — used for cache key generation.
 */
export function md5Hash(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

/**
 * Builds a Redis cache key for search results.
 * Key format: search:{tenantId}:{md5(queryString)}
 */
export function buildSearchCacheKey(tenantId: string, queryString: string): string {
  return `search:${tenantId}:${md5Hash(queryString)}`;
}

/**
 * Builds a Redis cache key for a single document.
 * Key format: doc:{tenantId}:{docId}
 */
export function buildDocumentCacheKey(tenantId: string, docId: string): string {
  return `doc:${tenantId}:${docId}`;
}

/**
 * Builds a Redis cache key for health status.
 * Key format: health:status
 */
export function buildHealthCacheKey(): string {
  return 'health:status';
}

/**
 * Builds a Redis key for rate limiting.
 * Key format: ratelimit:{tenantId}:{windowStart}
 */
export function buildRateLimitKey(tenantId: string): string {
  return `ratelimit:${tenantId}`;
}

/**
 * Builds the Elasticsearch index name for a given tenant.
 * Index format: documents_{tenantId}
 */
export function buildTenantIndexName(tenantId: string): string {
  // Sanitize tenantId to be a valid ES index name component
  const sanitized = tenantId.toLowerCase().replace(/[^a-z0-9-_]/g, '_');
  return `documents_${sanitized}`;
}

/**
 * Parses a comma-separated string into a trimmed array.
 */
export function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Calculates elapsed time in milliseconds from a start time (process.hrtime.bigint).
 */
export function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

/**
 * Clamps a number between min and max values.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Creates a standardized success response shape.
 */
export function successResponse<T>(
  data: T,
  meta?: Record<string, unknown>,
): { success: true; data: T; meta: Record<string, unknown> } {
  return {
    success: true,
    data,
    meta: {
      requestId: generateRequestId(),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Creates a standardized error response shape.
 */
export function errorResponse(
  code: string,
  message: string,
  requestId?: string,
): { success: false; error: Record<string, unknown> } {
  return {
    success: false,
    error: {
      code,
      message,
      requestId: requestId ?? generateRequestId(),
      timestamp: new Date().toISOString(),
    },
  };
}
