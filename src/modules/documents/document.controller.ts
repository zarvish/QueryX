import { Request, Response, NextFunction } from 'express';
import { DocumentService } from './document.service';
import { createDocumentSchema, updateDocumentSchema, documentIdParamSchema } from './document.schema';
import { ValidationError } from '../../utils/errors';
import { successResponse, elapsedMs } from '../../utils/helpers';
import { AuthenticatedRequest } from '../../types';

/**
 * Controller for document endpoints.
 * Handles request parsing, validation, delegates to service, and formats responses.
 */
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * POST /documents
   * Index a new document.
   */
  createDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const parsed = createDocumentSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new ValidationError('Invalid request body', parsed.error.format());
      }

      const document = await this.documentService.createDocument(
        authReq.tenantId,
        parsed.data,
      );

      const took = Math.round(elapsedMs(authReq.startTime));

      res.status(201).json(
        successResponse(document, { requestId: authReq.requestId, took }),
      );
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /documents/:id
   * Retrieve a document by ID.
   */
  getDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const parsedParams = documentIdParamSchema.safeParse(req.params);

      if (!parsedParams.success) {
        throw new ValidationError('Invalid document ID', parsedParams.error.format());
      }

      const document = await this.documentService.getDocument(
        authReq.tenantId,
        parsedParams.data.id,
      );

      const took = Math.round(elapsedMs(authReq.startTime));

      res.status(200).json(
        successResponse(document, { requestId: authReq.requestId, took }),
      );
    } catch (err) {
      next(err);
    }
  };

  /**
   * DELETE /documents/:id
   * Soft-delete a document.
   */
  deleteDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const parsedParams = documentIdParamSchema.safeParse(req.params);

      if (!parsedParams.success) {
        throw new ValidationError('Invalid document ID', parsedParams.error.format());
      }

      await this.documentService.deleteDocument(authReq.tenantId, parsedParams.data.id);

      const took = Math.round(elapsedMs(authReq.startTime));

      res.status(200).json(
        successResponse({ deleted: true, id: parsedParams.data.id }, { requestId: authReq.requestId, took }),
      );
    } catch (err) {
      next(err);
    }
  };

  /**
   * PATCH /documents/:id
   * Update document metadata.
   */
  updateDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const parsedParams = documentIdParamSchema.safeParse(req.params);

      if (!parsedParams.success) {
        throw new ValidationError('Invalid document ID', parsedParams.error.format());
      }

      const parsedBody = updateDocumentSchema.safeParse(req.body);

      if (!parsedBody.success) {
        throw new ValidationError('Invalid request body', parsedBody.error.format());
      }

      const document = await this.documentService.updateDocument(
        authReq.tenantId,
        parsedParams.data.id,
        parsedBody.data,
      );

      const took = Math.round(elapsedMs(authReq.startTime));

      res.status(200).json(
        successResponse(document, { requestId: authReq.requestId, took }),
      );
    } catch (err) {
      next(err);
    }
  };
}
