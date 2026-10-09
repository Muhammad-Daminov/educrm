import { z } from 'zod';

/**
 * TZ M1.3 "toʻlov usuli" — how money arrived (naqd, karta, oʻtkazma).
 * Deliberately carries no amounts, no fees and no behaviour: a payment
 * references it, and R0 has no rule that depends on which method was used.
 * Anything more would be inventing a money rule (CLAUDE.md).
 */
export const createPaymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type CreatePaymentMethodDto = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = createPaymentMethodSchema
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePaymentMethodDto = z.infer<typeof updatePaymentMethodSchema>;
