import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../types';
import { elapsedMs } from '../utils/helpers';

/**
 * Request logger middleware.
 * Logs every request with method, path, tenantId, statusCode, and responseTime.
 * Never logs request body content to avoid logging sensitive data.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  // Assign a requestId if not already set by tenant middleware
  const authenticatedReq = req as Partial<AuthenticatedRequest>;

  res.on('finish', () => {
    const responseTimeMs = elapsedMs(start);
    const tenantId = authenticatedReq.tenantId;
    const requestId = authenticatedReq.requestId;

    const logData = {
      requestId,
      tenantId,
      method: req.method,
      path: req.path,
      query: req.query,
      statusCode: res.statusCode,
      responseTimeMs: Math.round(responseTimeMs),
      userAgent: req.get('user-agent'),
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.error(logData, 'Request completed with server error');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'Request completed with client error');
    } else {
      logger.info(logData, 'Request completed');
    }
  });

  next();
}
