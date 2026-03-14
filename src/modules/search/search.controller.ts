import { Request, Response, NextFunction } from 'express';
import { SearchService } from './search.service';
import { searchQuerySchema } from './search.schema';
import { ValidationError } from '../../utils/errors';
import { successResponse, elapsedMs } from '../../utils/helpers';
import { AuthenticatedRequest } from '../../types';

/**
 * Controller for search endpoints.
 */
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * GET /search?q={query}&tenant={tenantId}&page=1&limit=10&tags=...&fuzzy=true
   */
  search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      const parsed = searchQuerySchema.safeParse({
        ...req.query,
        tenant: authReq.tenantId,
      });

      if (!parsed.success) {
        throw new ValidationError('Invalid search parameters', parsed.error.format());
      }

      const result = await this.searchService.search(authReq.tenantId, parsed.data);

      const took = Math.round(elapsedMs(authReq.startTime));

      res.status(200).json(
        successResponse(result, {
          requestId: authReq.requestId,
          took,
          total: result.total,
          page: result.page,
          limit: result.limit,
        }),
      );
    } catch (err) {
      next(err);
    }
  };
}
