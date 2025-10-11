import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/response.interface';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // Nếu data đã là ApiResponse format, trả về nguyên vẹn
        if (
          data &&
          typeof data === 'object' &&
          'status' in data &&
          'message' in data
        ) {
          return data as ApiResponse<T>;
        }

        // Nếu không, wrap data vào ApiResponse format
        return {
          status: 'success',
          message: 'Request completed successfully',
          data: data,
        } as ApiResponse<T>;
      }),
    );
  }
}
