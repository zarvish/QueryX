import { Request, Response, NextFunction } from 'express';
import { TenantError } from '../utils/errors';
import { getPrismaClient } from '../config/database';
import { TENANT_HEADER, AuthenticatedRequest } from '../types';
import { logger } from '../utils/logger';
import { generateRequestId } from '../utils/helpers';

const TENANT_ID_REGEX = /^[a-zA-Z0-9-_]{3,64}$/;

/**
 * Middleware that extracts and validates the X-Tenant-ID header.
 * Attaches tenantId and requestId to the request object.
 * Validates the tenant exists in the database and is active.
 * Returns 401 if tenant header is missing, malformed, or tenant is inactive.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = req.headers[TENANT_HEADER] as string | undefined;

  if (!tenantId) {
    const reqId = generateRequestId();
    logger.warn({ requestId: reqId, path: req.path }, 'Missing X-Tenant-ID header');
    res.status(401).json({
      success: false,
      error: {
        code: 'TENANT_ERROR',
        message: 'Missing X-Tenant-ID header',
        requestId: reqId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  if (!TENANT_ID_REGEX.test(tenantId)) {
    const reqId = generateRequestId();
    logger.warn({ requestId: reqId, tenantId }, 'Invalid tenant ID format');
    res.status(401).json({
      success: false,
      error: {
        code: 'TENANT_ERROR',
        message: 'Invalid X-Tenant-ID format (3-64 alphanumeric chars, dash, underscore)',
        requestId: reqId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  try {
    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, isActive: true, name: true },
    });

    if (!tenant) {
      throw new TenantError(`Tenant '${tenantId}' not found`);
    }

    if (!tenant.isActive) {
      throw new TenantError(`Tenant '${tenantId}' is inactive`);
    }

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.tenantId = tenantId;
    authenticatedReq.requestId = generateRequestId();
    authenticatedReq.startTime = process.hrtime.bigint();

    next();
  } catch (error) {
    if (error instanceof TenantError) {
      res.status(401).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: generateRequestId(),
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    next(error);
  }
}
