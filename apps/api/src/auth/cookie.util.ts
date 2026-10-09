import type { Request } from 'express';

/**
 * Reads directly from the raw `Cookie` header instead of relying on
 * `req.cookies` (which would need the `cookie-parser` middleware to have
 * already run). Avoids a real ordering hazard: nestjs-cls's `setup` hook
 * (where tenant/auth context gets established) runs as part of module
 * initialization, before any middleware manually `app.use()`'d in
 * main.ts — so a separately-registered cookie-parser could not be
 * guaranteed to run first.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}
