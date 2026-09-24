export interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data?: T;
  // Offset lists: page, limit, total, totalPages. Cursor lists: limit, nextCursor, hasMore.
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
  error?: ApiErrorBody;
}

export interface ApiErrorBody {
  /** HTTP status */
  code: number;
  /** Stable machine-readable code — clients branch on this, never on message */
  errorCode: string;
  details: unknown;
  requestId: string | null;
  path: string;
  timestamp: string;
}
