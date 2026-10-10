'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Table, TableContainer, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/toast-provider';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import { fetchActiveOptions } from '@/lib/resources';
import {
  addEnrollment,
  cancelEnrollment,
  changeStudyUnitStatus,
  fetchStudyUnit,
  finishEnrollment,
  freezeEnrollment,
  transferEnrollment,
  unfreezeEnrollment,
  type EnrollmentRow,
  type StudyUnitRow,
  type StudyUnitStatus,
} from '@/lib/units';

interface StudentOption {
  id: string;
  fullName: string;
}

const STATUS_TRANSITIONS: Record<StudyUnitStatus, StudyUnitStatus[]> = {
  forming: ['active', 'cancelled'],
  active: ['paused', 'finished', 'cancelled'],
  paused: ['active', 'finished', 'cancelled'],
  finished: [],
  cancelled: [],
};

function statusVariant(status: StudyUnitStatus): 'success' | 'outline' | 'destructive' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'cancelled') {
    return 'destructive';
  }
  if (status === 'finished') {
    return 'outline';
  }
  return 'default';
}

function enrollmentVariant(status: EnrollmentRow['status']): 'success' | 'warning' | 'outline' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'frozen') {
    return 'warning';
  }
  if (status === 'cancelled' || status === 'finished' || status === 'transferred') {
    return 'outline';
  }
  return 'default';
}

/**
 * TZ M4.1/M4.2, UX group detail: header + status machine + BR-U3/BR-U4
 * warning banners + a members table with add/transfer/cancel/finish/
 * freeze actions. BR-E1 overlap and status-transition errors from the API
 * are mapped to the i18n strings below rather than shown raw.
 */
export function UnitDetail({ unitId }: { unitId: string }): JSX.Element {
  const { me } = useAuth();
  const { showToast } = useToast();

  const [unit, setUnit] = useState<StudyUnitRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<EnrollmentRow | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudyUnit(unitId)
      .then((row) => {
        if (!cancelled) {
          setUnit(row);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unitId, reloadToken]);

  const canManageMembers = hasAnyPermission(me.permissions, ['study_unit.manage_members']);
  const canChangeStatus = hasAnyPermission(me.permissions, ['study_unit.change_status']);
  const canFreeze = hasAnyPermission(me.permissions, ['enrollment.freeze']);

  function reportError(caught: unknown): void {
    if (caught instanceof ApiError && caught.body.code === 'ENROLLMENT_OVERLAP') {
      showToast({ message: t('units.error.overlap'), variant: 'error' });
    } else if (caught instanceof ApiError && caught.body.code === 'INVALID_STATUS_TRANSITION') {
      showToast({ message: t('units.error.invalidTransition'), variant: 'error' });
    } else {
      showToast({
        message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    }
  }

  async function changeStatus(status: StudyUnitStatus): Promise<void> {
    if (unit === null) {
      return;
    }
    try {
      setUnit(await changeStudyUnitStatus(unit.id, unit.version, status));
      showToast({ message: t('toast.saved'), variant: 'success' });
    } catch (caught) {
      reportError(caught);
      reload();
    }
  }

  async function removeMember(enrollment: EnrollmentRow): Promise<void> {
    if (unit === null || !window.confirm(t('units.members.remove.confirm'))) {
      return;
    }
    try {
      await cancelEnrollment(unit.id, enrollment.id, enrollment.version);
      reload();
    } catch (caught) {
      reportError(caught);
    }
  }

  async function finishMember(enrollment: EnrollmentRow): Promise<void> {
    if (unit === null) {
      return;
    }
    try {
      await finishEnrollment(unit.id, enrollment.id, enrollment.version);
      reload();
    } catch (caught) {
      reportError(caught);
    }
  }

  async function toggleFreeze(enrollment: EnrollmentRow): Promise<void> {
    if (unit === null) {
      return;
    }
    try {
      if (enrollment.status === 'frozen') {
        await unfreezeEnrollment(unit.id, enrollment.id, enrollment.version);
      } else {
        await freezeEnrollment(unit.id, enrollment.id, enrollment.version);
      }
      reload();
    } catch (caught) {
      reportError(caught);
    }
  }

  if (loading) {
    return <LoadingState rows={6} />;
  }
  if (error !== null) {
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (unit === null) {
    return <ErrorState error={null} onRetry={reload} />;
  }

  const allowedTransitions = STATUS_TRANSITIONS[unit.status];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/units" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('units.back')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{unit.name}</h1>
          <Badge variant={statusVariant(unit.status)}>{t(`units.status.${unit.status}`)}</Badge>
        </div>
        {canChangeStatus && allowedTransitions.length > 0 && (
          <div className="flex gap-2">
            {allowedTransitions.map((next) => (
              <Button key={next} size="sm" onClick={() => void changeStatus(next)}>
                {t(`units.status.${next}`)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">{t('units.column.fill')}</p>
          <p className="text-lg font-semibold">
            {unit.enrolledCount}/{unit.capacity}
          </p>
        </div>
      </div>

      {unit.overCapacity && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {t('units.warning.overCapacity')}
        </p>
      )}
      {unit.belowMinSize && (
        <p
          role="alert"
          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {t('units.warning.belowMinSize')}
        </p>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('units.members.title')}</h2>
        {canManageMembers && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('units.members.add')}
          </Button>
        )}
      </div>

      {unit.enrollments.length === 0 ? (
        <EmptyState title={t('units.members.empty')} />
      ) : (
        <TableContainer>
          <Table>
            <thead>
              <tr>
                <Th>{t('units.members.column.student')}</Th>
                <Th>{t('units.members.column.period')}</Th>
                <Th>{t('units.members.column.status')}</Th>
                {canManageMembers && <Th>{t('list.actions')}</Th>}
              </tr>
            </thead>
            <tbody>
              {unit.enrollments.map((enrollment) => (
                <Tr key={enrollment.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/students/${enrollment.studentId}`}>
                      {enrollment.studentName}
                    </Link>
                  </Td>
                  <Td>
                    {enrollment.startDate} — {enrollment.endDate ?? ''}
                  </Td>
                  <Td>
                    <Badge variant={enrollmentVariant(enrollment.status)}>
                      {t(`units.enrollment.status.${enrollment.status}`)}
                    </Badge>
                  </Td>
                  {canManageMembers && (
                    <Td>
                      {(enrollment.status === 'active' || enrollment.status === 'frozen') && (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" onClick={() => setTransferTarget(enrollment)}>
                            {t('units.members.action.transfer')}
                          </Button>
                          {canFreeze && (
                            <Button size="sm" onClick={() => void toggleFreeze(enrollment)}>
                              {enrollment.status === 'frozen'
                                ? t('units.members.action.unfreeze')
                                : t('units.members.action.freeze')}
                            </Button>
                          )}
                          <Button size="sm" onClick={() => void finishMember(enrollment)}>
                            {t('units.members.action.finish')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void removeMember(enrollment)}>
                            {t('units.members.action.remove')}
                          </Button>
                        </div>
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      )}

      {addOpen && (
        <AddMemberDrawer
          unit={unit}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            reload();
          }}
          onError={reportError}
        />
      )}

      {transferTarget !== null && (
        <TransferDrawer
          unit={unit}
          enrollment={transferTarget}
          onClose={() => setTransferTarget(null)}
          onTransferred={() => {
            setTransferTarget(null);
            reload();
          }}
          onError={reportError}
        />
      )}
    </div>
  );
}

function AddMemberDrawer({
  unit,
  onClose,
  onAdded,
  onError,
}: {
  unit: StudyUnitRow;
  onClose: () => void;
  onAdded: () => void;
  onError: (error: unknown) => void;
}): JSX.Element {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchActiveOptions<StudentOption>('/api/v1/students')
      .then(setStudents)
      .catch(() => undefined);
  }, []);

  async function save(): Promise<void> {
    if (studentId === '') {
      return;
    }
    setSaving(true);
    try {
      await addEnrollment(unit.id, { studentId, startDate });
      onAdded();
    } catch (caught) {
      onError(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={t('units.members.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || studentId === ''}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="field-student" label={t('units.members.field.student')} required>
          <Select id="field-student" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
            <option value="">{t('form.select.empty')}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="field-start" label={t('units.members.field.startDate')} required>
          <Input
            id="field-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}

function TransferDrawer({
  unit,
  enrollment,
  onClose,
  onTransferred,
  onError,
}: {
  unit: StudyUnitRow;
  enrollment: EnrollmentRow;
  onClose: () => void;
  onTransferred: () => void;
  onError: (error: unknown) => void;
}): JSX.Element {
  interface UnitOption {
    id: string;
    name: string;
  }
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [toStudyUnitId, setToStudyUnitId] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchActiveOptions<UnitOption>('/api/v1/study-units')
      .then((rows) => setUnits(rows.filter((row) => row.id !== unit.id)))
      .catch(() => undefined);
  }, [unit.id]);

  async function save(): Promise<void> {
    if (toStudyUnitId === '') {
      return;
    }
    setSaving(true);
    try {
      await transferEnrollment(unit.id, enrollment.id, enrollment.version, { toStudyUnitId, transferDate });
      onTransferred();
    } catch (caught) {
      onError(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={t('units.members.transfer.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || toStudyUnitId === ''}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="field-target" label={t('units.members.transfer.field.target')} required>
          <Select
            id="field-target"
            value={toStudyUnitId}
            onChange={(event) => setToStudyUnitId(event.target.value)}
          >
            <option value="">{t('form.select.empty')}</option>
            {units.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="field-date" label={t('units.members.transfer.field.date')} required>
          <Input
            id="field-date"
            type="date"
            value={transferDate}
            onChange={(event) => setTransferDate(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
