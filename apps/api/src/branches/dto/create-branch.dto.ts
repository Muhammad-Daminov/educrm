import { z } from 'zod';

/**
 * TZ M1.1: nom, manzil, telefon, ish vaqti, timezone (default
 * Asia/Tashkent), qisqartma (code, for auto-naming groups).
 *
 * The timezone is validated against the runtime's IANA database rather than
 * taken on trust: every lesson time in TZ M4 is interpreted in the branch's
 * zone, so a typo here would silently shift a whole branch's schedule.
 */
const timezone = z.string().refine(isValidTimezone, {
  message: 'timezone must be a valid IANA zone, e.g. Asia/Tashkent',
});

function isValidTimezone(value: string): boolean {
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Short code used in generated group names ("CHL-A1-18:00"). */
  code: z.string().trim().min(1).max(32),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: timezone.optional(),
});

export type CreateBranchDto = z.infer<typeof createBranchSchema>;

/**
 * `code` is updatable but `isActive` is not: TZ M1.1 SHART says a branch is
 * deactivated, never deleted, and that is what POST /branches/:id/archive
 * is for — a flag buried in a PATCH body is too easy to flip by accident
 * for something that hides a whole branch's data.
 */
export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(1).max(32).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    timezone: timezone.optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateBranchDto = z.infer<typeof updateBranchSchema>;
