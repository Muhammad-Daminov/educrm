import { z } from 'zod';
import { branchScopedListQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M4.1 "study_unit". A single-step create form (no schedule step — T08
 * owns schedule_rules/lessons and doesn't exist yet): branch, discipline,
 * level, age category, type, capacity, min_size, responsible, color, dates.
 * `name` is optional — a blank name is auto-generated (see
 * `autoStudyUnitName` in study-units.service.ts).
 */
const isoDate = z.string().trim().date();

export const createStudyUnitSchema = z.object({
  branchId: z.string().uuid(),
  disciplineId: z.string().uuid(),
  levelId: z.string().uuid().nullable().optional(),
  ageCategoryId: z.string().uuid().nullable().optional(),
  type: z.enum(['group', 'mini_group', 'individual']),
  name: z.string().trim().min(1).max(200).nullable().optional(),
  capacity: z.coerce.number().int().positive().max(1000),
  minSize: z.coerce.number().int().min(0).max(1000),
  responsibleId: z.string().uuid().nullable().optional(),
  color: z.string().trim().max(20).nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
});

export type CreateStudyUnitDto = z.infer<typeof createStudyUnitSchema>;

/**
 * `branchId`/`disciplineId`/`type` are not updatable — the same structural
 * carve-out `ClassroomsService` makes for `branchId`: changing what a group
 * fundamentally *is* reads as "make a new one", not an edit.
 */
export const updateStudyUnitSchema = z
  .object({
    levelId: z.string().uuid().nullable().optional(),
    ageCategoryId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    capacity: z.coerce.number().int().positive().max(1000).optional(),
    minSize: z.coerce.number().int().min(0).max(1000).optional(),
    responsibleId: z.string().uuid().nullable().optional(),
    color: z.string().trim().max(20).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, { message: 'At least one field must be provided' });

export type UpdateStudyUnitDto = z.infer<typeof updateStudyUnitSchema>;

/**
 * BR-U2 (relaxed for R0, see docs/QUESTIONS.md): the allowed transition
 * graph is enforced in the service, not the schema — the schema only knows
 * this is one of the five enum values.
 */
export const changeStudyUnitStatusSchema = z.object({
  status: z.enum(['forming', 'active', 'paused', 'finished', 'cancelled']),
});

export type ChangeStudyUnitStatusDto = z.infer<typeof changeStudyUnitStatusSchema>;

export const studyUnitListQuerySchema = branchScopedListQuerySchema.extend({
  discipline_id: z.string().uuid().optional(),
  status: z.enum(['forming', 'active', 'paused', 'finished', 'cancelled']).optional(),
  /**
   * UX 4.3 "Kam toʻldirilgan" filter: enrolled count below `min_size`.
   * Plain `"true" | "false"` rather than `z.coerce.boolean()` — coercion
   * treats any non-empty string (including the literal text "false") as
   * truthy, which is exactly wrong for a query string. The service compares
   * against the literal `'true'`.
   */
  below_min_size: z.enum(['true', 'false']).optional(),
});

export type StudyUnitListQueryDto = z.infer<typeof studyUnitListQuerySchema>;

/** TZ M4.2 "enrollment" — adding a member to a study unit. */
export const createEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
});

export type CreateEnrollmentDto = z.infer<typeof createEnrollmentSchema>;

/** BR-E2: closes the old enrollment and opens a new one on the destination unit. */
export const transferEnrollmentSchema = z.object({
  toStudyUnitId: z.string().uuid(),
  transferDate: isoDate,
});

export type TransferEnrollmentDto = z.infer<typeof transferEnrollmentSchema>;

/** BR-E3: cancel (never hard-delete) is the "remove member" action. */
export const cancelEnrollmentSchema = z.object({
  endDate: isoDate.optional(),
  reason: z.string().trim().max(2000).optional(),
});

export type CancelEnrollmentDto = z.infer<typeof cancelEnrollmentSchema>;

/** The "end" action (UX "remove/end") — a natural finish, not a cancellation. */
export const finishEnrollmentSchema = z.object({
  endDate: isoDate.optional(),
});

export type FinishEnrollmentDto = z.infer<typeof finishEnrollmentSchema>;
