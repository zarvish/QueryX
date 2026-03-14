import { PrismaClient } from '@prisma/client';
import { config } from './index';
import { logger } from '../utils/logger';

let prismaClient: PrismaClient | null = null;

/**
 * Creates and returns a singleton Prisma client instance.
 */
export function createPrismaClient(): PrismaClient {
  if (prismaClient) {
    return prismaClient;
  }

  prismaClient = new PrismaClient({
    log:
      config.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    errorFormat: 'minimal',
  });

  logger.info('Prisma client created');

  return prismaClient;
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Prisma client not initialized');
  }
  return prismaClient;
}

export async function closePrismaClient(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
    logger.info('Prisma client disconnected');
  }
}
