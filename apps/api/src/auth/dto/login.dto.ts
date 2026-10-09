import { z } from 'zod';

export const loginSchema = z.object({
  tenant_slug: z.string().min(1),
  login: z.string().min(1),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof loginSchema>;
