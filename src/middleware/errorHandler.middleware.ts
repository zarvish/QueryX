import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { errorResponse } from '../utils/helpers';
import { AuthenticatedRequest } from '../types';

/**
 * Global error handler middleware.
 * Must be registered LAST in the Express middleware chain.
 * Converts AppErrors to structured JSON responses.
 * Logs all errors with appropriate severity levels.
 */
export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const authenticatedReq = req as Partial<AuthenticatedRequest>;
  const requestId = authenticatedReq.requestId ?? 'unknown';

  if (err instanceof AppError) {
    if (err.isOperational) {
      logger.warn(
        {
          requestId,
          tenantId: authenticatedReq.tenantId,
          code: err.code,
          statusCode: err.statusCode,
          path: req.path,
          method: req.method,
        },
        err.message,
      );
    } else {
      logger.error(
        {
          requestId,
          tenantId: authenticatedReq.tenantId,
          code: err.code,
          statusCode: err.statusCode,
          err,
          stack: err.stack,
        },
        'Non-operational error occurred',
      );
    }

    const response = errorResponse(err.code, err.message, requestId);

    // Add details for validation errors
    if ('details' in err && err.details) {
      (response.error as Record<string, unknown>)['details'] = err.details;
    }

    // Add retryAfter for rate limit errors
    if ('retryAfter' in err) {
      (response.error as Record<string, unknown>)['retryAfter'] = (err as { retryAfter: number }).retryAfter;
      res.set('Retry-After', String((err as { retryAfter: number }).retryAfter));
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Unknown / unexpected error
  logger.error(
    {
      requestId,
      tenantId: authenticatedReq.tenantId,
      err,
      stack: err.stack,
      path: req.path,
      method: req.method,
    },
    'Unexpected error',
  );

  res.status(500).json(
    errorResponse(
      'INTERNAL_SERVER_ERROR',
      'An unexpected error occurred',
      requestId,
    ),
  );
}

/**
 * 404 handler — must be registered after all routes.
 */
export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json(
    errorResponse('NOT_FOUND', `Route ${req.method} ${req.path} not found`),
  );
}
