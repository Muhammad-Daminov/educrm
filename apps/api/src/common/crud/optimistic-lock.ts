import { BadRequestException } from '@nestjs/common';
import { versionConflict } from './crud.errors';

/**
 * Optimistic locking, TZ 6.1: "PATCH soʻrovlari `If-Match: <version>` qabul
 * qiladi; mos kelmasa 409 VERSION_CONFLICT".
 *
 * The version is an integer the write bumps inside the same UPDATE it
 * filters on:
 *
 *   UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2
 *
 * so a lost update is impossible rather than unlikely. `updateMany`
 * returning 0 rows is the mismatch signal — it cannot distinguish "wrong
 * version" from "row gone", so the caller re-reads to tell the user which
 * (`settleFailedUpdate` below).
 *
 * The header is *accepted*, not required: a script that wants
 * last-write-wins may omit it, and the 409 only exists for clients that
 * opted into the check. Every screen in apps/web sends it.
 */
export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  // Accept both `5` and the quoted ETag form `"5"` / `W/"5"`: If-Match is an
  // HTTP header with an established syntax, and a client library may quote
  // it for us.
  const unquoted = raw
    .trim()
    .replace(/^W\//i, '')
    .replace(/^"(.*)"$/, '$1');
  if (!/^\d+$/.test(unquoted)) {
    throw new BadRequestException({
      code: 'INVALID_IF_MATCH',
      message: 'If-Match must be the integer version of the record',
      details: [{ field: 'If-Match', code: 'INVALID', value: raw }],
    });
  }
  return Number(unquoted);
}

/**
 * Decides what a zero-row UPDATE means, given a re-read of the row.
 *
 * Both outcomes are the caller's error, but they are different errors: a
 * 404 means the record is gone, a 409 means someone else edited it and the
 * UX §3.8 conflict dialog should offer to reload. Throws either way — it is
 * only called on a path that has already failed.
 */
export function settleFailedUpdate(
  entityType: string,
  id: string,
  expectedVersion: number,
  current: { version: number } | null,
  notFoundError: (entityType: string, id: string) => Error,
): never {
  if (current === null) {
    throw notFoundError(entityType, id);
  }
  throw versionConflict(entityType, id, expectedVersion, current.version);
}
