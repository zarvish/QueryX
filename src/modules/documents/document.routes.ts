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

const getDocumentController = () => {
  const repository = new DocumentRepository(getPrismaClient());
  const service = new DocumentService(
    repository,
    getElasticsearchClient(),
    getRedisClient(),
  );
  return new DocumentController(service);
};

// Apply tenant auth + rate limit on all document routes
router.use(tenantMiddleware);
router.use(rateLimitMiddleware);

// Routes
router.post('/', (req, res, next) => getDocumentController().createDocument(req, res, next).catch(next));
router.get('/:id', (req, res, next) => getDocumentController().getDocument(req, res, next).catch(next));
router.delete('/:id', (req, res, next) => getDocumentController().deleteDocument(req, res, next).catch(next));
router.patch('/:id', (req, res, next) => getDocumentController().updateDocument(req, res, next).catch(next));

export { router as documentRouter };
