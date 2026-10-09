import { z } from 'zod';
import { listQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M1.3 "daraja". `disciplineId` is nullable: UX P6 chains filial → fan →
 * daraja, so a level usually belongs to a discipline, but a centre that
 * grades everything A1..C2 should not re-enter the ladder per discipline.
 * Null means "applies to every discipline" (docs/QUESTIONS.md).
 */
export const createLevelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  disciplineId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type CreateLevelDto = z.infer<typeof createLevelSchema>;

export const updateLevelSchema = createLevelSchema
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateLevelDto = z.infer<typeof updateLevelSchema>;

/** `discipline_id=null` is not expressible in a query string; use `none`. */
export const levelListQuerySchema = listQuerySchema.extend({
  discipline_id: z.union([z.string().uuid(), z.literal('none')]).optional(),
});

export type LevelListQueryDto = z.infer<typeof levelListQuerySchema>;
