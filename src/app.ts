import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import { config } from './config';
import { createElasticsearchClient } from './config/elasticsearch';
import { createRedisClient } from './config/redis';
import { createPrismaClient } from './config/database';
import { closeElasticsearchClient } from './config/elasticsearch';
import { closeRedisClient } from './config/redis';
import { closePrismaClient } from './config/database';

import { requestLoggerMiddleware } from './middleware/requestLogger.middleware';
import { errorHandlerMiddleware, notFoundMiddleware } from './middleware/errorHandler.middleware';

import { documentRouter } from './modules/documents/document.routes';
import { searchRouter } from './modules/search/search.routes';
import { healthRouter } from './modules/health/health.routes';

import { logger } from './utils/logger';

/**
 * Initializes all service connections (ES, Redis, Prisma).
 * Called once at startup.
 */
async function initializeConnections(): Promise<void> {
  logger.info('Initializing service connections...');

  const prisma = createPrismaClient();
  createElasticsearchClient();
  createRedisClient();

  // Test DB connection
  await prisma.$connect();
  logger.info('PostgreSQL connected');
}

/**
 * Creates and configures the Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // ─── Security & Parsing Middleware ───────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Request Logging ─────────────────────────────────────────────
  app.use(requestLoggerMiddleware);

  // ─── Routes ──────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/documents', documentRouter);
  app.use('/search', searchRouter);

  // ─── 404 Handler ─────────────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ─── Global Error Handler ─────────────────────────────────────────
  app.use(errorHandlerMiddleware);

  return app;
}

/**
 * Main server startup function.
 */
async function bootstrap(): Promise<void> {
  try {
    await initializeConnections();

    const app = createApp();
    const port = config.PORT;

    const server = app.listen(port, () => {
      logger.info(
        {
          port,
          env: config.NODE_ENV,
          deploymentColor: config.DEPLOYMENT_COLOR,
        },
        `🚀 QueryX API server started on port ${port}`,
      );
    });

    // ─── Graceful Shutdown ─────────────────────────────────────────
    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Graceful shutdown initiated');

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await Promise.all([
            closeElasticsearchClient(),
            closeRedisClient(),
            closePrismaClient(),
          ]);
          logger.info('All connections closed. Goodbye!');
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        }
      });

      // Force exit after 30 seconds if connections don't close
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30_000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.fatal({ err }, 'Uncaught exception');
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled rejection');
      process.exit(1);
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

if (config.NODE_ENV !== 'test') {
  bootstrap();
}
