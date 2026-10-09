import { describe, expect, it } from 'vitest';
import { backoffMs, MAX_ATTEMPTS, MAX_CAUSATION_DEPTH } from '../src/outbox/outbox.constants';

describe('outbox retry policy (TZ M2)', () => {
  it('gives up after 5 attempts', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('cuts event chains deeper than 3', () => {
    expect(MAX_CAUSATION_DEPTH).toBe(3);
  });

  it('backs off exponentially', () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
    expect(backoffMs(4)).toBe(80_000);
  });

  it('never waits longer than an hour', () => {
    expect(backoffMs(50)).toBe(60 * 60_000);
  });

  it('does not wait at all before the first attempt', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(-1)).toBe(0);
  });

  it('is monotonic, so a later attempt never retries sooner', () => {
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect(backoffMs(attempt + 1)).toBeGreaterThanOrEqual(backoffMs(attempt));
    }
  });
});
