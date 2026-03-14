import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),

  // Database
  DATABASE_URL: z.string().url(),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().url(),
  ELASTICSEARCH_USERNAME: z.string().default('elastic'),
  ELASTICSEARCH_PASSWORD: z.string(),

  // Redis
  REDIS_URL: z.string(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),

  // Cache TTLs
  CACHE_SEARCH_TTL: z.string().default('60').transform(Number),
  CACHE_DOCUMENT_TTL: z.string().default('300').transform(Number),
  CACHE_HEALTH_TTL: z.string().default('10').transform(Number),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // Deployment
  DEPLOYMENT_COLOR: z.enum(['blue', 'green']).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
