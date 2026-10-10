import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../../database/tenant-prisma.provider';
import { AuditService } from '../../audit/audit.service';
import { snapshotOf } from '../../audit/audit-diff';
import { normalizePhone } from '../../auth/phone.util';
import { CrudDeps } from '../../common/crud/crud.deps';
import type { Tx } from '../../common/crud/archivable-crud.service';
import { notFound } from '../../common/crud/crud.errors';
import { parseCsv } from './csv.util';
import type {
  ImportConfirmResult,
  ImportDryRunResult,
  ImportRowError,
  StudentImportMapping,
} from './import.dto';

interface ValidRow {
  rowNumber: number;
  fullName: string;
  phone: string;
  branchId: string;
  birthDate: string | null;
  gender: 'male' | 'female' | null;
}

interface ValidationOutcome {
  totalRows: number;
  valid: ValidRow[];
  errors: ImportRowError[];
}

/**
 * TZ M11.1 student import: CSV only (see docs/QUESTIONS.md for why XLSX is
 * deferred). Stateless by design — there is no server-side session between
 * steps, so `dryRun` and `confirm` both take the same file + mapping and
 * re-run the identical validation; `confirm` just also writes. That trades
 * one re-parse of a small file for not needing Redis-backed upload state in
 * R0's single-request flow.
 */
@Injectable()
export class StudentsImportService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly deps: CrudDeps,
    private readonly audit: AuditService,
  ) {}

  async dryRun(fileText: string, mapping: StudentImportMapping): Promise<ImportDryRunResult> {
    const { totalRows, valid, errors } = await this.validate(fileText, mapping);
    return { totalRows, validCount: valid.length, errors };
  }

  async confirm(fileText: string, fileName: string, mapping: StudentImportMapping): Promise<ImportConfirmResult> {
    const { totalRows, valid, errors } = await this.validate(fileText, mapping);

    const batch = await this.tenantDb.transaction(async (tx) => {
      const batchRow = await tx.importBatch.create({
        data: {
          id: uuidv7(),
          tenantId: this.deps.tenantId,
          entityType: 'students',
          fileName,
          totalRows,
          importedCount: valid.length,
          errorCount: errors.length,
        },
      });

      for (const row of valid) {
        await this.importOneRow(tx, batchRow.id, row);
      }

      await this.audit.record(
        {
          action: 'student.import.confirm',
          entityType: 'import_batch',
          entityId: batchRow.id,
          diff: snapshotOf({
            fileName,
            totalRows,
            importedCount: valid.length,
            errorCount: errors.length,
          }),
        },
        tx,
      );
      return batchRow;
    });

    return {
      batchId: batch.id,
      totalRows,
      importedCount: valid.length,
      errorCount: errors.length,
      errors,
    };
  }

  /** TZ M11.1 SHART: rollback archives every row the batch created. No
   * ledger storno — nothing writes to the ledger yet (T10/T11). */
  async rollback(batchId: string): Promise<{ archivedCount: number }> {
    return this.tenantDb.transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (batch === null) {
        throw notFound('import_batch', batchId);
      }
      if (batch.rolledBackAt !== null) {
        return { archivedCount: 0 };
      }

      const { count } = await tx.student.updateMany({
        where: { importBatchId: batchId, status: { not: 'archived' } },
        data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
      });
      await tx.importBatch.update({ where: { id: batchId }, data: { rolledBackAt: new Date() } });

      await this.audit.record(
        {
          action: 'student.import.rollback',
          entityType: 'import_batch',
          entityId: batchId,
          diff: snapshotOf({ archivedCount: count }),
        },
        tx,
      );
      return { archivedCount: count };
    });
  }

  private async importOneRow(tx: Tx, batchId: string, row: ValidRow): Promise<void> {
    const clientId = uuidv7();
    await tx.client.create({
      data: {
        id: clientId,
        tenantId: this.deps.tenantId,
        fullName: row.fullName,
        birthDate: row.birthDate === null ? null : new Date(row.birthDate),
        gender: row.gender,
      },
    });
    await tx.clientPhone.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        clientId,
        phoneE164: row.phone,
        isPrimary: true,
      },
    });
    await tx.student.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        clientId,
        branchId: row.branchId,
        importBatchId: batchId,
      },
    });
  }

  private async validate(fileText: string, mapping: StudentImportMapping): Promise<ValidationOutcome> {
    const { headers, rows } = parseCsv(fileText);
    const columnIndex = new Map(headers.map((header, index) => [header.trim(), index]));

    const missingColumns = [mapping.fullName, mapping.phone, mapping.branchCode].filter(
      (column) => !columnIndex.has(column),
    );
    if (missingColumns.length > 0) {
      return {
        totalRows: rows.length,
        valid: [],
        errors: missingColumns.map((column) => ({
          row: 0,
          field: column,
          code: 'COLUMN_NOT_FOUND',
          value: column,
        })),
      };
    }

    const branches = await this.tenantDb.branch.findMany({ select: { id: true, code: true } });
    const branchByCode = new Map(branches.map((branch) => [branch.code, branch.id]));

    const valid: ValidRow[] = [];
    const errors: ImportRowError[] = [];
    const seenPhones = new Set<string>();

    for (const [index, cells] of rows.entries()) {
      const rowNumber = index + 2; // header is row 1, data starts at row 2
      const cell = (column: string): string => (cells[columnIndex.get(column) ?? -1] ?? '').trim();

      const fullName = cell(mapping.fullName);
      if (fullName === '') {
        errors.push({ row: rowNumber, field: 'fullName', code: 'REQUIRED', value: '' });
        continue;
      }

      const rawPhone = cell(mapping.phone);
      const normalizedPhone = normalizePhone(rawPhone);
      if (normalizedPhone === null) {
        errors.push({ row: rowNumber, field: 'phone', code: 'INVALID', value: rawPhone });
        continue;
      }
      if (seenPhones.has(normalizedPhone)) {
        errors.push({ row: rowNumber, field: 'phone', code: 'DUPLICATE_IN_FILE', value: rawPhone });
        continue;
      }
      const existingPhone = await this.tenantDb.clientPhone.findFirst({
        where: { phoneE164: normalizedPhone },
      });
      if (existingPhone !== null) {
        errors.push({ row: rowNumber, field: 'phone', code: 'DUPLICATE_PHONE', value: rawPhone });
        continue;
      }

      const branchCode = cell(mapping.branchCode);
      const branchId = branchByCode.get(branchCode);
      if (branchId === undefined) {
        errors.push({ row: rowNumber, field: 'branchCode', code: 'REFERENCE_NOT_FOUND', value: branchCode });
        continue;
      }

      const birthDateRaw = mapping.birthDate === undefined ? '' : cell(mapping.birthDate);
      if (birthDateRaw !== '' && Number.isNaN(Date.parse(birthDateRaw))) {
        errors.push({ row: rowNumber, field: 'birthDate', code: 'INVALID', value: birthDateRaw });
        continue;
      }

      const genderRaw = mapping.gender === undefined ? '' : cell(mapping.gender).toLowerCase();
      if (genderRaw !== '' && genderRaw !== 'male' && genderRaw !== 'female') {
        errors.push({ row: rowNumber, field: 'gender', code: 'INVALID', value: genderRaw });
        continue;
      }

      seenPhones.add(normalizedPhone);
      valid.push({
        rowNumber,
        fullName,
        phone: normalizedPhone,
        branchId,
        birthDate: birthDateRaw === '' ? null : birthDateRaw,
        gender: genderRaw === '' ? null : genderRaw,
      });
    }

    return { totalRows: rows.length, valid, errors };
  }
}
