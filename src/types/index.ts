import { Request } from 'express';

// ─────────────────────────────────────────────
// Request augmentation
// ─────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  tenantId: string;
  requestId: string;
  startTime: bigint;
}

// ─────────────────────────────────────────────
// API Response shapes
// ─────────────────────────────────────────────

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
    details?: unknown;
  };
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  took?: number;
  total?: number;
  page?: number;
  limit?: number;
}

// ─────────────────────────────────────────────
// Document types
// ─────────────────────────────────────────────

export interface DocumentDto {
  id: string;
  tenantId: string;
  title: string;
  content?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  author?: string;
  tags: string[];
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDocumentInput {
  title: string;
  content?: string;
  author?: string;
  tags?: string[];
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  author?: string;
  tags?: string[];
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
}

// ─────────────────────────────────────────────
// Elasticsearch document shape
// ─────────────────────────────────────────────

export interface EsDocument {
  doc_id: string;
  tenant_id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

// ─────────────────────────────────────────────
// Search types
// ─────────────────────────────────────────────

export interface SearchQuery {
  q: string;
  tenant: string;
  page?: number;
  limit?: number;
  tags?: string;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
  fuzzy?: boolean;
}

export interface SearchHit {
  id: string;
  score: number;
  title: string;
  author?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  highlights?: {
    title?: string[];
    content?: string[];
  };
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  limit: number;
  took: number;
  facets?: {
    tags: Array<{ key: string; count: number }>;
    authors: Array<{ key: string; count: number }>;
  };
}

// ─────────────────────────────────────────────
// Health check types
// ─────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthCheckResult {
  status: HealthStatus;
  version: string;
  uptime: number;
  deploymentColor?: string;
  dependencies: {
    elasticsearch: DependencyHealth;
    redis: DependencyHealth;
    database: DependencyHealth;
  };
}

// ─────────────────────────────────────────────
// Tenant types
// ─────────────────────────────────────────────

export interface TenantDto {
  id: string;
  name: string;
  plan: string;
  rateLimit: number;
  isActive: boolean;
  createdAt: Date;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const TENANT_HEADER = 'x-tenant-id';

export enum DocumentPlan {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}
