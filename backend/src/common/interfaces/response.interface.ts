export interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data?: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
  error?: {
    code: number;
    details?: any;
  };
}
