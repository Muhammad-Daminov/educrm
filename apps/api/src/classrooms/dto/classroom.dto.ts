import { z } from 'zod';
import { branchScopedListQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M1.2 "Xonalar": name, capacity, branch, equipment, is_active.
 * Occupancy is never stored here — it is derived from lessons (TZ M4.4).
 *
 * `capacity` is a soft limit: TZ M4.2 wants a *warning* when a group
 * outgrows its room, not a refusal, so nothing in R0 blocks on it.
 */
export const createClassroomSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().positive().max(1000).nullable().optional(),
  equipment: z.string().trim().max(2000).nullable().optional(),
});

export type CreateClassroomDto = z.infer<typeof createClassroomSchema>;

/**
 * `branchId` is intentionally absent: moving a room between branches would
 * silently relocate every lesson ever taught in it. Archive it and create
 * the room in the other branch instead.
 */
export const updateClassroomSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    capacity: z.number().int().positive().max(1000).nullable().optional(),
    equipment: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateClassroomDto = z.infer<typeof updateClassroomSchema>;

export const classroomListQuerySchema = branchScopedListQuerySchema;
export type ClassroomListQueryDto = z.infer<typeof classroomListQuerySchema>;
