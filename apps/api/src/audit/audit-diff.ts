/**
 * Field names whose values must never reach the audit log, even though the
 * surrounding record change is very much worth auditing. A log is read by
 * more people than the table it describes.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'secret',
  'apikey',
  'api_key',
  'csrftoken',
  'csrf_token',
]);

const REDACTED_PLACEHOLDER = '[redacted]';

/**
 * JSONB-safe value. Declared here rather than reusing `Prisma.JsonValue`
 * because that type describes what Prisma *reads* (required properties) and
 * is not assignable to the `InputJsonValue` it accepts on *write* — which
 * is the direction this module exists for.
 */
export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

/**
 * `{ field: { before, after } }` for changed fields only.
 *
 * Typed as a plain JSON map rather than `Record<string, {before, after}>`
 * so it stays assignable to Prisma's `InputJsonValue` without a cast at
 * every call site — an interface with named properties is not assignable to
 * an index-signature type.
 */
export type AuditDiff = Record<string, AuditJsonValue>;

function isRedacted(field: string): boolean {
  return REDACTED_FIELDS.has(field.toLowerCase());
}

/**
 * Converts a value into something `JSONB` can hold.
 *
 * bigint becomes a decimal *string* rather than a number: money is BIGINT
 * tiyin (TZ M6.1) and `JSON.stringify` throws on bigint outright, so without
 * this every audited money change would either crash the operation it was
 * supposed to be recording or — worse, if someone "fixed" it with Number() —
 * record a rounded amount. Same representation TZ 6.1 uses on the wire.
 */
function toJsonValue(value: unknown): AuditJsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'symbol':
      return value.toString();
    case 'object':
      break;
    default:
      // function / undefined: nothing a persisted record should contain.
      return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  const result: Record<string, AuditJsonValue> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isRedacted(key) ? REDACTED_PLACEHOLDER : toJsonValue(nested);
  }
  return result;
}

function sameJson(left: AuditJsonValue, right: AuditJsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Builds the `diff` JSONB column of an audit row: only the fields that
 * actually changed, each as `{ before, after }`.
 *
 * Only keys present in `after` are considered — callers pass the fields
 * they are updating, and a key missing from the update is not a change to
 * null. Redacted fields are reported as changed (so "the password was
 * rotated" is still auditable) but never with their values.
 */
export function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditDiff {
  const diff: AuditDiff = {};

  for (const [field, afterValue] of Object.entries(after)) {
    if (isRedacted(field)) {
      const changed = !sameJson(toJsonValue(before[field]), toJsonValue(afterValue));
      if (changed) {
        diff[field] = { before: REDACTED_PLACEHOLDER, after: REDACTED_PLACEHOLDER };
      }
      continue;
    }

    const beforeJson = toJsonValue(before[field]);
    const afterJson = toJsonValue(afterValue);
    if (!sameJson(beforeJson, afterJson)) {
      diff[field] = { before: beforeJson, after: afterJson };
    }
  }

  return diff;
}

/** Whole-record snapshot for create/delete-shaped actions, JSONB-safe. */
export function snapshotOf(record: Record<string, unknown>): Record<string, AuditJsonValue> {
  const snapshot: Record<string, AuditJsonValue> = {};
  for (const [field, value] of Object.entries(record)) {
    snapshot[field] = isRedacted(field) ? REDACTED_PLACEHOLDER : toJsonValue(value);
  }
  return snapshot;
}
