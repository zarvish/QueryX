import { Request, Response } from 'express';
import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getRedisClient } from '../../config/redis';
import { getElasticsearchClient } from '../../config/elasticsearch';
import { getPrismaClient } from '../../config/database';
import { buildHealthCacheKey } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { HealthCheckResult, HealthStatus, DependencyHealth } from '../../types';
import { config } from '../../config';

const APP_START_TIME = Date.now();

/**
 * Checks Elasticsearch connectivity and latency.
 */
async function checkElasticsearch(esClient: Client): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await esClient.cluster.health({ timeout: '5s' });
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, 'Elasticsearch health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Checks Redis connectivity and latency.
 */
async function checkRedis(redis: Redis): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const pong = await redis.ping();
    return {
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    logger.warn({ err }, 'Redis health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Checks PostgreSQL connectivity and latency via Prisma.
 */
async function checkDatabase(prisma: PrismaClient): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, 'Database health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message: (err as Error).message,
    };
  }
}

/**
 * Computes overall system health from dependency health results.
 */
function computeOverallStatus(deps: HealthCheckResult['dependencies']): HealthStatus {
  const statuses = Object.values(deps).map((d) => d.status);
  if (statuses.every((s) => s === 'healthy')) return 'healthy';
  if (statuses.some((s) => s === 'unhealthy')) return 'unhealthy';
  return 'degraded';
}

/**
 * Health check controller.
 * Returns full system status with dependency latencies.
 * Results are cached for 10 seconds to avoid hammering dependencies.
 */
export async function healthController(_req: Request, res: Response): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = buildHealthCacheKey();

  // Check cache
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    logger.debug('Health check cache HIT');
    res.status(200).json({ success: true, data: JSON.parse(cached) });
    return;
  }

  const [esHealth, redisHealth, dbHealth] = await Promise.all([
    checkElasticsearch(getElasticsearchClient()),
    checkRedis(redis),
    checkDatabase(getPrismaClient()),
  ]);

  const dependencies = {
    elasticsearch: esHealth,
    redis: redisHealth,
    database: dbHealth,
  };

  const result: HealthCheckResult = {
    status: computeOverallStatus(dependencies),
    version: '1.0.0',
    uptime: Math.round((Date.now() - APP_START_TIME) / 1000),
    deploymentColor: config.DEPLOYMENT_COLOR,
    dependencies,
  };

  // Cache for 10 seconds
  await redis
    .setex(cacheKey, config.CACHE_HEALTH_TTL, JSON.stringify(result))
    .catch(() => null);

  logger.debug(
    { overallStatus: result.status, uptime: result.uptime },
    'Health check completed',
  );

  const httpStatus = result.status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json({ success: true, data: result });
}
