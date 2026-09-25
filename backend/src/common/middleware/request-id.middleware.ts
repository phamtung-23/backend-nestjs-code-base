import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Registered with app.use() in setupApp so it runs before the body parser and
// every error response can carry the id. The id is always generated here:
// accepting a client-supplied one would let callers reuse or copy ids and mix
// their log lines and audit entries with someone else's.
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  RequestContext.run(
    {
      requestId,
      // req.ip is the client IP because setupApp trusts the Traefik hop
      ipAddress: req.ip,
      // Stored in audit rows and shown to admins: no control characters
      userAgent: req
        .header('user-agent')
        ?.replace(/\p{Cc}/gu, '')
        .slice(0, 500),
    },
    next,
  );
}
