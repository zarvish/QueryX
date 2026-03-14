import { v4 as uuidv4 } from 'uuid';

/**
 * Base application error class.
 * All custom errors extend from this.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly requestId: string;
  public readonly timestamp: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.requestId = uuidv4();
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found error.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/**
 * 400 Validation error.
 */
export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * 401 Tenant authentication/authorization error.
 */
export class TenantError extends AppError {
  constructor(message = 'Invalid or missing tenant') {
    super(message, 401, 'TENANT_ERROR');
  }
}

/**
 * 429 Rate limit exceeded error.
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number, message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

/**
 * 502 Search engine / upstream error.
 */
export class SearchError extends AppError {
  constructor(message = 'Search engine error') {
    super(message, 502, 'SEARCH_ERROR', false);
  }
}

/**
 * 409 Conflict error (e.g., duplicate resource).
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}
