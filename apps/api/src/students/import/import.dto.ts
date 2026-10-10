import { z } from 'zod';

/**
 * TZ M11.1: "fayl → mapping → dry-run validatsiya → xatolar → tasdiq →
 * import". `mapping` is which CSV column holds which student field — a
 * saved/reusable mapping template is listed as part of the flow but is not
 * a SHART/KERAK of its own, so it is not persisted here (see
 * docs/QUESTIONS.md); the caller resends the mapping on every call.
 *
 * Fields mirror `createStudentSchema`'s minimal create set: `branchCode`
 * (not `branchId`) because a CSV a human prepared names the branch, not its
 * internal id.
 */
export const studentImportMappingSchema = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  branchCode: z.string().trim().min(1),
  birthDate: z.string().trim().min(1).optional(),
  gender: z.string().trim().min(1).optional(),
});

export type StudentImportMapping = z.infer<typeof studentImportMappingSchema>;

export const importMappingFormSchema = z.object({
  mapping: z.string().transform((value, ctx) => {
    try {
      return studentImportMappingSchema.parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mapping must be valid JSON matching the schema' });
      return z.NEVER;
    }
  }),
});

export type ImportMappingFormDto = z.infer<typeof importMappingFormSchema>;

export interface ImportRowError {
  row: number;
  field: string;
  code: string;
  value: string;
}

export interface ImportDryRunResult {
  totalRows: number;
  validCount: number;
  errors: ImportRowError[];
}

export interface ImportConfirmResult {
  batchId: string;
  totalRows: number;
  importedCount: number;
  errorCount: number;
  errors: ImportRowError[];
}
