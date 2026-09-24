import { ConsoleLogger } from '@nestjs/common';
import { RequestContext } from '../context/request-context';

// Adds the current request id to every log line written during a request:
// [Nest] 123  - ...  ERROR [GlobalExceptionFilter] [req 7f1c...] message
export class AppLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const formatted = super.formatContext(context);
    const requestId = RequestContext.requestId();
    return requestId ? `${formatted}[req ${requestId}] ` : formatted;
  }
}
