import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SuccessEnvelope } from '../helpers/response.helper';

// Wraps whatever a handler returns in the success envelope, unless it already
// is one (built with ResponseHelper)
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, SuccessEnvelope<unknown>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessEnvelope<unknown>> {
    return next
      .handle()
      .pipe(
        map((data) =>
          data instanceof SuccessEnvelope ? data : new SuccessEnvelope(data),
        ),
      );
  }
}
