const HEX_PAIR = 2;

/**
 * RFC 9562 UUIDv7: 48-bit unix-ms timestamp + version/variant bits + random tail.
 * Sortable by creation time, unlike v4 — useful as a PK that still hides any
 * sequential/auto-increment signal.
 *
 * Uses the Web Crypto API (`globalThis.crypto.getRandomValues`) rather than
 * `node:crypto` — this package is imported from apps/web client components
 * too, and a `node:` built-in has no browser equivalent a bundler can
 * substitute. Web Crypto is the one randomness source both Node (18.19+/20+,
 * global since Node 19) and every browser provide identically.
 */
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const rand = globalThis.crypto.getRandomValues(new Uint8Array(10));
  const bytes = new Uint8Array(16);

  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  const randA0 = rand[0];
  const randA1 = rand[1];
  const randB0 = rand[2];
  if (randA0 === undefined || randA1 === undefined || randB0 === undefined) {
    throw new Error('uuidv7: insufficient random bytes');
  }

  bytes[6] = 0x70 | (randA0 & 0x0f); // version 0111
  bytes[7] = randA1;
  bytes[8] = 0x80 | (randB0 & 0x3f); // variant 10
  for (let i = 9; i < 16; i += 1) {
    const byte = rand[i - 6];
    if (byte === undefined) {
      throw new Error('uuidv7: insufficient random bytes');
    }
    bytes[i] = byte;
  }

  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(HEX_PAIR, '0');
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
