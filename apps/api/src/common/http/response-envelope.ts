/**
 * TZ 6.2 response envelope: `{ "data": ..., "meta": { "next_cursor": ...,
 * "total": 1234 } }`.
 *
 * Controllers return their payload as-is and the interceptor wraps it, so
 * no handler has to remember the envelope. A handler that also has
 * pagination or totals to report returns `new Enveloped(payload, meta)`
 * instead — that is the only case where the envelope is visible in a
 * controller, and it is visible precisely because `meta` is a decision
 * (what the total counts, whether there is a next page) rather than
 * boilerplate.
 */

/** Keys are snake_case because they go on the wire (TZ 6.1/6.2). */
export interface ResponseMeta {
  /** Total matching rows, ignoring limit/offset — the P1 header count. */
  total?: number;
  limit?: number;
  offset?: number;
  /** TZ 6.1 cursor pagination; null means "no more pages". */
  next_cursor?: string | null;
}

export class Enveloped<T> {
  constructor(
    readonly data: T,
    readonly meta: ResponseMeta,
  ) {}
}

/** What a client actually receives. */
export interface ResponseEnvelope<T> {
  data: T;
  meta?: ResponseMeta;
}

export function envelope<T>(value: T | Enveloped<T>): ResponseEnvelope<T> {
  if (value instanceof Enveloped) {
    return { data: value.data, meta: value.meta };
  }
  return { data: value };
}
