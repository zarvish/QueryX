import { Router } from 'express';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { getElasticsearchClient } from '../../config/elasticsearch';
import { getRedisClient } from '../../config/redis';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { rateLimitMiddleware } from '../../middleware/rateLimit.middleware';

const router = Router();

// Compose dependencies
const service = new SearchService(getElasticsearchClient(), getRedisClient());
const controller = new SearchController(service);

// Apply tenant auth + rate limit
router.use(tenantMiddleware);
router.use(rateLimitMiddleware);

router.get('/', controller.search);

export { router as searchRouter };
