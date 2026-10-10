import { z } from 'zod';
import { branchScopedListQuerySchema } from '../../common/crud/list-query.dto';

/**
 * TZ M3 "o'quvchilar". UX P6 "Minimal + keyin to'ldirish": creating a
 * student asks for 5 fields (ism, telefon, filial, fan, manba) — `fan`
 * (discipline) and `manba` (lead source) belong to the enrollment/lead this
 * student doesn't have yet (T07/M2), so T06's create form is the three
 * fields that exist today: full name, phone, branch. Everything else is
 * filled in on the card afterwards.
 */
const phone = z.string().trim().min(5).max(20);

export const createStudentSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: phone,
  branchId: z.string().uuid(),
  birthDate: z.string().trim().date().nullable().optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
  /**
   * UX P6 "Bu raqam bilan ... bor. Ochish / Shunga bog'lash": the duplicate
   * check is a *warning*, not a hard block — `force: true` is what the
   * second button sends after the user has seen the existing record and
   * decided to create a new one anyway.
   */
  force: z.boolean().optional(),
});

export type CreateStudentDto = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    branchId: z.string().uuid().optional(),
    birthDate: z.string().trim().date().nullable().optional(),
    gender: z.enum(['male', 'female']).nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    blacklisted: z.boolean().optional(),
    blacklistReason: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateStudentDto = z.infer<typeof updateStudentSchema>;

export const studentListQuerySchema = branchScopedListQuerySchema.extend({
  status: z.enum(['active', 'frozen', 'finished', 'no_enrollment', 'archived']).optional(),
});

export type StudentListQueryDto = z.infer<typeof studentListQuerySchema>;

export const checkPhoneQuerySchema = z.object({
  phone: phone,
});

export type CheckPhoneQueryDto = z.infer<typeof checkPhoneQuerySchema>;

/** Full replacement of the phone list — mirrors `setBranchesSchema`'s shape. */
export const setPhonesSchema = z.object({
  phones: z
    .array(
      z.object({
        phone: phone,
        isPrimary: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10),
});

export type SetPhonesDto = z.infer<typeof setPhonesSchema>;

export const createContactPersonSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  relation: z.string().trim().min(1).max(100),
  phone: phone.nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  isBillRecipient: z.boolean().optional(),
  receivesNotifications: z.boolean().optional(),
});

export type CreateContactPersonDto = z.infer<typeof createContactPersonSchema>;

export const updateContactPersonSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    relation: z.string().trim().min(1).max(100).optional(),
    phone: phone.nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    isBillRecipient: z.boolean().optional(),
    receivesNotifications: z.boolean().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateContactPersonDto = z.infer<typeof updateContactPersonSchema>;
