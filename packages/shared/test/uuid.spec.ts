import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../src/uuid';

describe('uuidv7', () => {
  it('produces a syntactically valid uuid', () => {
    expect(isUuid(uuidv7())).toBe(true);
  });

  it('sets version nibble to 7', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
  });

  it('sets the variant bits to 10xx', () => {
    const id = uuidv7();
    const variantNibble = parseInt(id[19] as string, 16);
    expect(variantNibble & 0b1100).toBe(0b1000);
  });

  it('encodes the current unix-ms timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const tsHex = id.slice(0, 8) + id.slice(9, 13);
    const ts = parseInt(tsHex, 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});

describe('isUuid', () => {
  it('rejects non-uuid strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
