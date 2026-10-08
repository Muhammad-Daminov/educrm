import { z } from 'zod';

export const createBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type CreateBranchDto = z.infer<typeof createBranchSchema>;
