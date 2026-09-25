import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ClientMeta } from '../interfaces/client-meta.interface';

// @ClientMetaParam() meta: ClientMeta — keeps Express types out of services.
// req.ip is the real client IP because setupApp trusts the Traefik hop.
export const ClientMetaParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientMeta => {
    const request = context.switchToHttp().getRequest<Request>();
    return {
      userAgent: request.header('user-agent')?.slice(0, 500),
      ipAddress: request.ip,
    };
  },
);
