import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  id: string;
}

export interface RequestIdSource {
  headers: IncomingHttpHeaders;
  id?: string | number | object;
}

/**
 * Reuses an already-assigned req.id (e.g. set by pino-http if it ran first),
 * else falls back to the incoming header, else generates a new id. Kept
 * order-independent so logging middleware and this middleware always agree.
 */
export function resolveRequestId(req: RequestIdSource): string {
  if (typeof req.id === 'string' && req.id.length > 0) {
    return req.id;
  }
  if (typeof req.id === 'number') {
    return String(req.id);
  }

  const incoming = req.headers[REQUEST_ID_HEADER];
  const fromHeader = Array.isArray(incoming) ? incoming[0] : incoming;
  return fromHeader || randomUUID();
}

/**
 * Idempotent: safe to call more than once per request (e.g. once eagerly
 * from the CLS middleware's `setup` hook, before any tenant/auth logic that
 * might throw, and again here) since it reuses req.id if already set.
 */
export function assignRequestId(req: Request, res: Response): string {
  const requestId = resolveRequestId(req);
  (req as RequestWithId).id = requestId;
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    assignRequestId(req, res);
    next();
  }
}
