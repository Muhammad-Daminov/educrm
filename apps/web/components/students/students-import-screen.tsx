'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { useAuth } from '@/components/auth-provider';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { useToast } from '@/components/toast-provider';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import {
  importConfirm,
  importDryRun,
  importRollback,
  type ImportConfirmResult,
  type ImportDryRunResult,
  type StudentImportMapping,
} from '@/lib/students';

const MAPPING_FIELDS: { key: keyof StudentImportMapping; labelKey: Parameters<typeof t>[0]; required: boolean }[] = [
  { key: 'fullName', labelKey: 'studentsImport.mapping.fullName', required: true },
  { key: 'phone', labelKey: 'studentsImport.mapping.phone', required: true },
  { key: 'branchCode', labelKey: 'studentsImport.mapping.branchCode', required: true },
  { key: 'birthDate', labelKey: 'studentsImport.mapping.birthDate', required: false },
  { key: 'gender', labelKey: 'studentsImport.mapping.gender', required: false },
];

/** First line of a CSV file, split on commas — only for populating the
 * mapping selects with real column names; the server re-parses the whole
 * file properly (quotes, embedded commas) for the actual import. */
async function sniffHeaders(file: File): Promise<string[]> {
  const text = await file.text();
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const withoutBom = firstLine.charCodeAt(0) === 0xfeff ? firstLine.slice(1) : firstLine;
  return withoutBom
    .split(',')
    .map((header) => header.trim())
    .filter((header) => header !== '');
}

/** A column named exactly (case-insensitively) one of these auto-fills
 * that mapping field, so a sensibly-named file needs no manual mapping at
 * all — the user still sees and can override every choice. */
const HEADER_GUESSES: Record<keyof StudentImportMapping, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'ism', 'toliq ism', "to'liq ism"],
  phone: ['phone', 'telefon'],
  branchCode: ['branch', 'branch code', 'filial'],
  birthDate: ['birth date', 'birthdate', "tug'ilgan sana"],
  gender: ['gender', 'sex', 'jinsi'],
};

function guessMapping(headers: string[]): Partial<StudentImportMapping> {
  const guess: Partial<StudentImportMapping> = {};
  for (const field of MAPPING_FIELDS) {
    const candidates = HEADER_GUESSES[field.key];
    const match = headers.find((header) => candidates.includes(header.trim().toLowerCase()));
    if (match !== undefined) {
      guess[field.key] = match;
    }
  }
  return guess;
}

/**
 * TZ M11.1: fayl → mapping → dry-run → xatolar → tasdiq → import, all on
 * one page since the flow is short and stateless on the server (the file
 * is re-sent at each step — see `StudentsImportService`'s comment).
 */
export function StudentsImportScreen(): JSX.Element {
  const { me } = useAuth();
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<StudentImportMapping>>({});
  const [dryRun, setDryRun] = useState<ImportDryRunResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<ImportConfirmResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);

  async function onFileChange(selected: File | null): Promise<void> {
    setFile(selected);
    setDryRun(null);
    setConfirmResult(null);
    setRolledBack(false);
    if (selected === null) {
      setHeaders([]);
      return;
    }
    const detected = await sniffHeaders(selected);
    setHeaders(detected);
    setMapping(guessMapping(detected));
  }

  const requiredMapped = MAPPING_FIELDS.filter((field) => field.required).every(
    (field) => mapping[field.key] !== undefined && mapping[field.key] !== '',
  );

  function asMapping(): StudentImportMapping {
    return {
      fullName: mapping.fullName ?? '',
      phone: mapping.phone ?? '',
      branchCode: mapping.branchCode ?? '',
      ...(mapping.birthDate ? { birthDate: mapping.birthDate } : {}),
      ...(mapping.gender ? { gender: mapping.gender } : {}),
    };
  }

  async function runDryRun(): Promise<void> {
    if (file === null) {
      return;
    }
    setBusy(true);
    try {
      setDryRun(await importDryRun(file, asMapping()));
    } catch (error) {
      showToast({
        message: error instanceof ApiError ? error.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm(): Promise<void> {
    if (file === null) {
      return;
    }
    setBusy(true);
    try {
      const result = await importConfirm(file, asMapping());
      setConfirmResult(result);
      showToast({ message: t('studentsImport.success'), variant: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof ApiError ? error.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function runRollback(): Promise<void> {
    if (confirmResult === null) {
      return;
    }
    if (!window.confirm(t('studentsImport.rollback.confirm'))) {
      return;
    }
    setBusy(true);
    try {
      await importRollback(confirmResult.batchId);
      setRolledBack(true);
      showToast({ message: t('studentsImport.rollback.success'), variant: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof ApiError ? error.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!hasAnyPermission(me.permissions, ['import.run'])) {
    return <ForbiddenState />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/students" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('students.back')}
      </Link>

      <h1 className="text-xl font-semibold">{t('studentsImport.title')}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('studentsImport.step.upload')}</h2>
        <p className="text-sm text-muted-foreground">{t('studentsImport.upload.hint')}</p>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label={t('studentsImport.upload.choose')}
          onChange={(event) => void onFileChange(event.target.files?.[0] ?? null)}
        />
      </section>

      {headers.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{t('studentsImport.step.mapping')}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {MAPPING_FIELDS.map((field) => (
              <Field id={`mapping-${field.key}`} key={field.key} label={t(field.labelKey)} required={field.required}>
                <Select
                  id={`mapping-${field.key}`}
                  value={mapping[field.key] ?? ''}
                  onChange={(event) =>
                    setMapping((previous) => ({ ...previous, [field.key]: event.target.value || undefined }))
                  }
                >
                  <option value="">{t('form.select.empty')}</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div>
            <Button disabled={!requiredMapped || busy} onClick={() => void runDryRun()}>
              {t('studentsImport.dryRun')}
            </Button>
          </div>
        </section>
      )}

      {dryRun !== null && confirmResult === null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{t('studentsImport.step.review')}</h2>
          <div className="flex gap-6 text-sm">
            <p>
              {t('studentsImport.result.total')}: <strong>{dryRun.totalRows}</strong>
            </p>
            <p>
              {t('studentsImport.result.valid')}: <strong>{dryRun.validCount}</strong>
            </p>
            <p>
              {t('studentsImport.result.errors')}: <strong>{dryRun.errors.length}</strong>
            </p>
          </div>
          {dryRun.errors.length > 0 && (
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('studentsImport.result.row')}</Th>
                    <Th>{t('studentsImport.result.field')}</Th>
                    <Th>{t('studentsImport.result.code')}</Th>
                    <Th>{t('studentsImport.result.value')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.errors.map((error, index) => (
                    <Tr key={index}>
                      <Td>{error.row}</Td>
                      <Td>{error.field}</Td>
                      <Td>{error.code}</Td>
                      <Td>{error.value}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          )}
          {dryRun.validCount > 0 && (
            <div>
              <Button variant="primary" disabled={busy} onClick={() => void runConfirm()}>
                {t('studentsImport.confirm')}
              </Button>
            </div>
          )}
        </section>
      )}

      {confirmResult !== null && (
        <section className="flex flex-col gap-3 rounded-md border border-border p-4">
          <p className="text-sm">
            {t('studentsImport.result.imported')}: <strong>{confirmResult.importedCount}</strong> /{' '}
            {confirmResult.totalRows} ({t('studentsImport.result.errors')}: {confirmResult.errorCount})
          </p>
          {!rolledBack ? (
            <div>
              <Button variant="danger" disabled={busy} onClick={() => void runRollback()}>
                {t('studentsImport.rollback')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('studentsImport.rollback.success')}</p>
          )}
        </section>
      )}
    </div>
  );
}
