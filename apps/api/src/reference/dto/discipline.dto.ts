import { z } from 'zod';

/**
 * TZ M1.3 "fan". Body field names are camelCase, matching the domain model
 * and the /auth/me response shipped in 0.3; the snake_case in TZ 6.1/6.2 is
 * used for envelope and query keys (`meta.total`, `?is_active=`). Recorded
 * as a judgment call in docs/QUESTIONS.md.
 */
export const createDisciplineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Manual ordering for the picker; ties fall back to the name (TZ 8.5 key). */
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type CreateDisciplineDto = z.infer<typeof createDisciplineSchema>;

/**
 * PATCH is partial by definition, but an empty body is a mistake rather
 * than a no-op: it would bump `version` and write an audit row describing
 * nothing.
 */
export const updateDisciplineSchema = createDisciplineSchema
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'At least one field must be provided' });

export type UpdateDisciplineDto = z.infer<typeof updateDisciplineSchema>;
