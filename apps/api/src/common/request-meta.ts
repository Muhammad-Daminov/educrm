import { Injectable } from '@nestjs/common';
import { ClsService, type ClsService as ClsServiceType } from 'nestjs-cls';
import type { Request } from 'express';

export const REQUEST_META_KEY = 'request_meta';

/**
 * The per-request facts TZ M11.3 requires on every audit row, captured once
 * at the edge and read back anywhere down the call stack without threading
 * `req` through service signatures.
 */
export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * Called from the CLS middleware's `setup` hook, i.e. before any guard can
 * reject the request — an audit row written while handling a *rejected*
 * request still needs its ip and request id.
 */
export function captureRequestMeta(cls: ClsServiceType, req: Request, requestId: string): void {
  cls.set<RequestMeta>(REQUEST_META_KEY, {
    requestId,
    // `req.ip` already honours Express's trust-proxy setting. Kept as the
    // raw string (see the audit_log migration for why `ip` is TEXT).
    ip: req.ip ?? null,
    userAgent: firstHeader(req.headers['user-agent']),
  });
}

@Injectable()
export class RequestMetaService {
  constructor(private readonly cls: ClsService) {}

  /**
   * Undefined outside an HTTP request — a worker job has no ip, user agent
   * or request id, and TZ M11.3's format allows all three to be absent.
   */
  get current(): RequestMeta | undefined {
    return this.cls.get<RequestMeta>(REQUEST_META_KEY);
  }
}
