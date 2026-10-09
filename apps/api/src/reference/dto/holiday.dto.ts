import { z } from 'zod';
import { listQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M1.3 "bayramlar". Lesson materialization skips these dates (T08 /
 * TZ M4.3), so a holiday is a scheduling input, not decoration.
 *
 * `branchId` null means the whole organization is closed; a branch id means
 * only that branch is. Dates are plain calendar days (`YYYY-MM-DD`) and not
 * timestamps on purpose: "1 September" is the same day in every timezone,
 * and storing it as an instant is how it becomes 31 August for someone.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'date must be a real calendar date',
  });

export const createHolidaySchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: calendarDate,
  branchId: z.string().uuid().nullable().optional(),
});

export type CreateHolidayDto = z.infer<typeof createHolidaySchema>;

export const updateHolidaySchema = createHolidaySchema
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateHolidayDto = z.infer<typeof updateHolidaySchema>;

/**
 * The schedule screens ask "what is closed between these two dates", so the
 * list filters on a range as well as on the branch.
 */
export const holidayListQuerySchema = listQuerySchema.extend({
  branch_id: z.union([z.string().uuid(), z.literal('none')]).optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});

export type HolidayListQueryDto = z.infer<typeof holidayListQuerySchema>;

/** `YYYY-MM-DD` -> the UTC midnight Postgres stores for a DATE column. */
export function toCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
