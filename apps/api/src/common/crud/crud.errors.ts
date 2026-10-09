import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The error vocabulary the T05 write endpoints share. Every one of these is
 * a TZ 6.2 body — `{ code, message, details }` — because the frontend keys
 * off `code` for i18n and never off the message text (TZ 6.2 SHART).
 */

/** TZ 6.1: `If-Match: <version>`; mismatch is 409 VERSION_CONFLICT. */
export const IF_MATCH_HEADER = 'if-match';

export function notFound(entityType: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND',
    message: `${entityType} not found`,
    details: [{ field: 'id', code: 'NOT_FOUND', value: id }],
  });
}

/**
 * UX §3.8 "Versiya konflikti": the screen shows "Bu yozuvni X 2 daqiqa
 * oldin oʻzgartirdi" and offers a choice, which needs the *current*
 * version back — otherwise the client has nothing to retry with.
 */
export function versionConflict(
  entityType: string,
  id: string,
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'VERSION_CONFLICT',
    message: `${entityType} was changed by someone else`,
    details: [
      {
        field: 'version',
        code: 'VERSION_CONFLICT',
        expected_version: expected,
        current_version: actual,
        entity_id: id,
      },
    ],
  });
}

/**
 * A name that collides with an existing row *after* TZ 8.5 folding — so
 * "Ingliz tili" collides with "ingliz  tili" and with the ASCII-apostrophe
 * spelling. The field is named so UX P6 can put the message on the input
 * that caused it ("server xatolari field boʻyicha mos maydonga").
 */
export function duplicateName(entityType: string, field: string, value: string): ConflictException {
  return new ConflictException({
    code: 'DUPLICATE_NAME',
    message: `${entityType} with this name already exists`,
    details: [{ field, code: 'DUPLICATE', value }],
  });
}

/** A referenced row does not exist in this tenant (or was never visible). */
export function unknownReference(field: string, value: string): NotFoundException {
  return new NotFoundException({
    code: 'REFERENCE_NOT_FOUND',
    message: `Referenced ${field} does not exist`,
    details: [{ field, code: 'NOT_FOUND', value }],
  });
}

/**
 * Translates Prisma's unique-violation into DUPLICATE_NAME.
 *
 * Needed as a *backstop* rather than as the primary check: the services
 * look for an existing row first, to give a field-level error before any
 * write, but two concurrent creates both pass that check and the database
 * is what decides. Without this they would surface as a 500.
 *
 * P2002 is the unique constraint violation; the constraint name tells us
 * which field to blame. Anything else is rethrown untouched.
 */
export function rethrowAsDuplicate(
  error: unknown,
  entityType: string,
  field: string,
  value: string,
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw duplicateName(entityType, field, value);
  }
  throw error;
}
