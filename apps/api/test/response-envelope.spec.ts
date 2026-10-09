import { describe, expect, it } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Enveloped, envelope } from '../src/common/http/response-envelope';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';

function httpContext(type: 'http' | 'rpc' = 'http'): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('envelope()', () => {
  it('wraps a plain payload under data, with no meta', () => {
    expect(envelope({ id: 'b1' })).toEqual({ data: { id: 'b1' } });
  });

  it('keeps meta when the handler built one', () => {
    expect(envelope(new Enveloped([{ id: 'b1' }], { total: 7, limit: 50, offset: 0 }))).toEqual({
      data: [{ id: 'b1' }],
      meta: { total: 7, limit: 50, offset: 0 },
    });
  });

  it('wraps arrays rather than spreading them', () => {
    // A bare array response is what TZ 6.2 replaces: `{data: [...]}` leaves
    // room for meta, a top-level array does not.
    expect(envelope([1, 2])).toEqual({ data: [1, 2] });
  });

  it('wraps null and false, which are legitimate payloads', () => {
    expect(envelope(null)).toEqual({ data: null });
    expect(envelope(false)).toEqual({ data: false });
  });

  it('does not double-wrap something that merely looks enveloped', () => {
    // Only the Enveloped marker class is passed through; a payload that
    // happens to have a `data` key stays the payload.
    expect(envelope<{ data: string }>({ data: 'user typed this' })).toEqual({
      data: { data: 'user typed this' },
    });
  });
});

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor();

  it('wraps an HTTP response', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(httpContext(), handlerReturning({ ok: true })),
    );
    expect(result).toEqual({ data: { ok: true } });
  });

  it('passes an Enveloped result through with its meta', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(httpContext(), handlerReturning(new Enveloped(['a'], { total: 1 }))),
    );
    expect(result).toEqual({ data: ['a'], meta: { total: 1 } });
  });

  it('leaves non-HTTP contexts alone', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(httpContext('rpc'), handlerReturning({ ok: true })),
    );
    expect(result).toEqual({ ok: true });
  });
});
