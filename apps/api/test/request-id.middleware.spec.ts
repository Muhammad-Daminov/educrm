import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Request, Response } from 'express';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';

function createMockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function createMockRes(): { res: Response; setHeader: Mock } {
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  return { res, setHeader };
}

describe('RequestIdMiddleware', () => {
  it('generates a request id when none is present on the incoming request', () => {
    const middleware = new RequestIdMiddleware();
    const req = createMockReq();
    const { res, setHeader } = createMockRes();
    const next = vi.fn();

    middleware.use(req, res, next);

    const assignedId = (req as unknown as { id: string }).id;
    expect(assignedId).toBeTruthy();
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', assignedId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('reuses the incoming x-request-id header instead of generating a new one', () => {
    const middleware = new RequestIdMiddleware();
    const req = createMockReq({ 'x-request-id': 'incoming-id-123' });
    const { res, setHeader } = createMockRes();
    const next = vi.fn();

    middleware.use(req, res, next);

    expect((req as unknown as { id: string }).id).toBe('incoming-id-123');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'incoming-id-123');
  });

  it('reuses an id already set on the request (e.g. by earlier logging middleware)', () => {
    const middleware = new RequestIdMiddleware();
    const req = createMockReq();
    (req as unknown as { id: string }).id = 'already-set-id';
    const { res, setHeader } = createMockRes();
    const next = vi.fn();

    middleware.use(req, res, next);

    expect((req as unknown as { id: string }).id).toBe('already-set-id');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'already-set-id');
  });
});
