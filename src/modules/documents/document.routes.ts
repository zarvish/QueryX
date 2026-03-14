import { Router } from 'express';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentRepository } from './document.repository';
import { getPrismaClient } from '../../config/database';
import { getElasticsearchClient } from '../../config/elasticsearch';
import { getRedisClient } from '../../config/redis';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { rateLimitMiddleware } from '../../middleware/rateLimit.middleware';

const router = Router();

// Compose dependencies
const repository = new DocumentRepository(getPrismaClient());
const service = new DocumentService(
  repository,
  getElasticsearchClient(),
  getRedisClient(),
);
const controller = new DocumentController(service);

// Apply tenant auth + rate limit on all document routes
router.use(tenantMiddleware);
router.use(rateLimitMiddleware);

// Routes
router.post('/', controller.createDocument);
router.get('/:id', controller.getDocument);
router.delete('/:id', controller.deleteDocument);
router.patch('/:id', controller.updateDocument);

export { router as documentRouter };
