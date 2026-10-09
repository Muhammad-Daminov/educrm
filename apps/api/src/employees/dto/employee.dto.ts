import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../../auth/auth.constants';
import { branchScopedListQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M1.4 "Xodimlar": toʻliq ism, telefon, email, rol(lar), filial(lar),
 * is_active.
 *
 * At least one of phone/email is required because those are the login
 * identifiers (`auth_find_user` resolves a login by either) — an employee
 * with neither could never sign in, which is a silently broken account
 * rather than a useful record.
 */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s()-]{7,20}$/, 'phone must be a phone number');

export const createEmployeeSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    phone: phone.nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    /**
     * Set by the administrator for R0. TZ M1.6's invite-by-SMS/Telegram
     * flow is R1 (no messaging in R0 at all), so the alternative would be
     * an account nobody can log into.
     */
    password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
    roleCodes: z.array(z.string().trim().min(1)).max(20).optional(),
    branchIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .refine((dto) => Boolean(dto.phone) || Boolean(dto.email), {
    message: 'Either phone or email is required — it is the login identifier',
    path: ['phone'],
  });

export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;

/**
 * No `isActive` and no `password`: deactivation is POST /:id/deactivate
 * (TZ M1.4 SHART — it also revokes sessions, which a PATCH field would
 * not), and roles/branches have their own PUT endpoints so that changing
 * them is an explicit, auditable act rather than a field in a form body.
 */
export const updateEmployeeSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    phone: phone.nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;

/** Full replacement, not a delta: the UI edits the whole set at once. */
export const setRolesSchema = z.object({
  roleCodes: z.array(z.string().trim().min(1)).max(20),
});

export type SetRolesDto = z.infer<typeof setRolesSchema>;

export const setBranchesSchema = z.object({
  branchIds: z.array(z.string().uuid()).max(100),
});

export type SetBranchesDto = z.infer<typeof setBranchesSchema>;

/**
 * TZ M1.4 "Oʻqituvchi profili": fanlar, darajalar. Salary settings and
 * weekly availability are R1 (no payroll in R0), and the free-text note is
 * what the reception actually needs in the meantime.
 */
export const setTeacherProfileSchema = z.object({
  disciplineIds: z.array(z.string().uuid()).max(100),
  levelIds: z.array(z.string().uuid()).max(200),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type SetTeacherProfileDto = z.infer<typeof setTeacherProfileSchema>;

export const employeeListQuerySchema = branchScopedListQuerySchema.extend({
  /** Filter by role code, e.g. `?role_code=teacher` for the teacher picker. */
  role_code: z.string().trim().min(1).max(64).optional(),
});

export type EmployeeListQueryDto = z.infer<typeof employeeListQuerySchema>;
