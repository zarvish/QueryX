import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis';
import { getPrismaClient } from '../config/database';
import { RateLimitError } from '../utils/errors';
import { buildRateLimitKey } from '../utils/helpers';
import { AuthenticatedRequest } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

const RATE_LIMIT_WINDOW_SECONDS = Math.floor(config.RATE_LIMIT_WINDOW_MS / 1000);

/**
 * Per-tenant sliding window rate limiter using Redis.
 * Default: 100 requests per minute per tenant.
 * Tenant rate limit overrides are stored in the database.
 * Returns 429 with Retry-After header when limit is exceeded.
 */
export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authenticatedReq = req as AuthenticatedRequest;
  const tenantId = authenticatedReq.tenantId;

  if (!tenantId) {
    next();
    return;
  }

  try {
    const redis = getRedisClient();
    const prisma = getPrismaClient();

    // Fetch tenant's custom rate limit from DB (or use default)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { rateLimit: true },
    });

    const maxRequests = tenant?.rateLimit ?? config.RATE_LIMIT_MAX_REQUESTS;
    const key = buildRateLimitKey(tenantId);
    const now = Date.now();

    // Sliding window: store timestamps of each request
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, now - config.RATE_LIMIT_WINDOW_MS);
    pipeline.zcard(key);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.expire(key, RATE_LIMIT_WINDOW_SECONDS);

    const results = await pipeline.exec();

    if (!results) {
      logger.warn({ tenantId }, 'Rate limit pipeline returned null, skipping');
      next();
      return;
    }

    const currentCount = (results[1]?.[1] as number) ?? 0;

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - currentCount - 1)));
    res.set('X-RateLimit-Reset', String(Math.ceil((now + config.RATE_LIMIT_WINDOW_MS) / 1000)));

    if (currentCount >= maxRequests) {
      const retryAfter = Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000);
      res.set('Retry-After', String(retryAfter));

      logger.warn(
        { tenantId, currentCount, maxRequests },
        'Rate limit exceeded',
      );

      const error = new RateLimitError(retryAfter);
      res.status(429).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: authenticatedReq.requestId,
          timestamp: new Date().toISOString(),
          retryAfter,
        },
      });
      return;
    }

    logger.debug(
      { tenantId, currentCount, maxRequests },
      'Rate limit check passed',
    );

    next();
  } catch (err) {
    // Don't fail requests if Redis is down — fail open
    logger.error({ err, tenantId }, 'Rate limit check failed, allowing request');
    next();
  }
}
