import { z } from 'zod';

/**
 * TZ M1.3 "yosh toifasi". An open-ended top band ("16+") has no maxAge.
 * The band is also checked in the database (age_categories_band_valid) —
 * this is the copy that produces a field-level message for UX P6.
 */
export const createAgeCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    minAge: z.number().int().min(0).max(120),
    maxAge: z.number().int().min(0).max(120).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((dto) => dto.maxAge === null || dto.maxAge === undefined || dto.maxAge >= dto.minAge, {
    message: 'maxAge must be greater than or equal to minAge',
    path: ['maxAge'],
  });

export type CreateAgeCategoryDto = z.infer<typeof createAgeCategorySchema>;

/**
 * Partial, so the band check cannot run on the payload alone — raising
 * minAge above an unchanged maxAge is only visible against the stored row,
 * which is why AgeCategoriesService re-checks it there. The database
 * CHECK is the backstop under both.
 */
export const updateAgeCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    minAge: z.number().int().min(0).max(120).optional(),
    maxAge: z.number().int().min(0).max(120).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateAgeCategoryDto = z.infer<typeof updateAgeCategorySchema>;
