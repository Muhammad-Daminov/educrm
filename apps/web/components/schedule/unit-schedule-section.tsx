'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/toast-provider';
import { t, type TranslationKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import { fetchActiveOptions } from '@/lib/resources';
import {
  createScheduleRule,
  deactivateScheduleRule,
  fetchScheduleRules,
  formatDayNumber,
  previewScheduleRule,
  todayLocal,
  updateScheduleRule,
  weekStart,
  type SchedulePreview,
  type ScheduleRule,
  type ScheduleRuleInput,
} from '@/lib/schedule';

interface ClassroomOption {
  id: string;
  name: string;
  branchId: string;
}
interface EmployeeOption {
  id: string;
  fullName: string;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * The group page's schedule block: the rules a study unit has, plus the
 * editor with UX 4.3 step 2's live preview ("24 dars, birinchisi 14.10,
 * oxirgisi 30.12. Konflikt: 2 (bayram 1, xona band 1)").
 *
 * This is also what satisfies BR-U2 in the UI: a `forming` group cannot go
 * `active` without a rule, so the empty state says so rather than leaving
 * the user to discover it from a 409.
 */
export function UnitScheduleSection({
  studyUnitId,
  branchId,
  enrolledCount,
}: {
  studyUnitId: string;
  branchId: string;
  enrolledCount: number;
}): JSX.Element {
  const { me } = useAuth();
  const { showToast } = useToast();

  const [rules, setRules] = useState<ScheduleRule[] | null>(null);
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [teachers, setTeachers] = useState<EmployeeOption[]>([]);
  const [editing, setEditing] = useState<ScheduleRule | 'new' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const canCreate = hasAnyPermission(me.permissions, ['schedule.create']);
  const canUpdate = hasAnyPermission(me.permissions, ['schedule.update']);
  const canDelete = hasAnyPermission(me.permissions, ['schedule.delete']);

  useEffect(() => {
    let cancelled = false;
    fetchScheduleRules(studyUnitId)
      .then((rows) => {
        if (!cancelled) {
          setRules(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRules([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyUnitId, reloadToken]);

  useEffect(() => {
    Promise.all([
      fetchActiveOptions<ClassroomOption>('/api/v1/classrooms'),
      fetchActiveOptions<EmployeeOption>('/api/v1/employees'),
    ])
      .then(([classroomOptions, employeeOptions]) => {
        setClassrooms(classroomOptions.filter((room) => room.branchId === branchId));
        setTeachers(employeeOptions);
      })
      .catch(() => undefined);
  }, [branchId]);

  async function deactivate(rule: ScheduleRule): Promise<void> {
    if (!window.confirm(t('schedule.rule.deactivate.confirm'))) {
      return;
    }
    try {
      await deactivateScheduleRule(rule.id, rule.version);
      showToast({ message: t('toast.saved'), variant: 'success' });
      reload();
    } catch (caught) {
      showToast({
        message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    }
  }

  const activeRules = (rules ?? []).filter((rule) => rule.isActive);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('schedule.rule.title')}</h2>
        <div className="flex gap-2">
          <Link href={`/schedule?week=${weekStart(todayLocal())}`}>
            <Button size="sm">
              <CalendarDays className="size-4" aria-hidden="true" />
              {t('schedule.title')}
            </Button>
          </Link>
          {canCreate && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden="true" />
              {t('schedule.rule.add')}
            </Button>
          )}
        </div>
      </div>

      {rules === null ? null : activeRules.length === 0 ? (
        <p
          role="alert"
          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {t('schedule.rule.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {activeRules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {rule.daysOfWeek
                    .map((day) => t(`schedule.weekday.short.${day}` as TranslationKey))
                    .join(', ')}{' '}
                  · {rule.startTime}
                  {rule.endTime === null ? '' : `–${rule.endTime}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDayNumber(rule.periodStart)}
                  {rule.periodEnd === null ? '' : ` — ${formatDayNumber(rule.periodEnd)}`} ·{' '}
                  {rule.classroomName ?? t('schedule.lesson.noClassroom')} ·{' '}
                  {rule.teacherName ?? t('schedule.lesson.noTeacher')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {rule.lessonCount} {t('schedule.rule.lessons')}
                </Badge>
                {canUpdate && (
                  <Button size="sm" onClick={() => setEditing(rule)}>
                    {t('list.edit')}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="danger" onClick={() => void deactivate(rule)}>
                    {t('schedule.rule.deactivate')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <ScheduleRuleDrawer
          studyUnitId={studyUnitId}
          rule={editing === 'new' ? null : editing}
          classrooms={classrooms}
          teachers={teachers}
          enrolledCount={enrolledCount}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

/**
 * The rule editor. Every change re-runs `POST /schedule-rules/preview`
 * (debounced), which is the TZ M4.3 SHART endpoint — so the user sees the
 * lesson count and the conflicts *before* saving rather than discovering
 * them in a 409.
 */
function ScheduleRuleDrawer({
  studyUnitId,
  rule,
  classrooms,
  teachers,
  enrolledCount,
  onClose,
  onSaved,
}: {
  studyUnitId: string;
  rule: ScheduleRule | null;
  classrooms: readonly ClassroomOption[];
  teachers: readonly EmployeeOption[];
  enrolledCount: number;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { showToast } = useToast();
  const today = useMemo(() => todayLocal(), []);

  const [days, setDays] = useState<number[]>(rule?.daysOfWeek ?? [1, 3, 5]);
  const [startTime, setStartTime] = useState(rule?.startTime ?? '18:00');
  const [endTime, setEndTime] = useState(rule?.endTime ?? '19:30');
  const [periodStart, setPeriodStart] = useState(rule?.periodStart ?? today);
  const [periodEnd, setPeriodEnd] = useState(rule?.periodEnd ?? '');
  const [classroomId, setClassroomId] = useState(rule?.classroomId ?? '');
  const [teacherId, setTeacherId] = useState(rule?.teacherId ?? '');
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const valid =
    days.length > 0 && endTime > startTime && periodEnd !== '' && periodEnd >= periodStart;

  const input: ScheduleRuleInput = useMemo(
    () => ({
      studyUnitId,
      daysOfWeek: [...days].sort((left, right) => left - right),
      startTime,
      endTime,
      periodStart,
      periodEnd: periodEnd === '' ? null : periodEnd,
      classroomId: classroomId === '' ? null : classroomId,
      teacherId: teacherId === '' ? null : teacherId,
    }),
    [studyUnitId, days, startTime, endTime, periodStart, periodEnd, classroomId, teacherId],
  );

  // Debounced so typing a date does not fire a request per keystroke.
  useEffect(() => {
    if (!valid) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    const timer = setTimeout(() => {
      previewScheduleRule(input, rule?.id)
        .then((result) => {
          if (!cancelled) {
            setPreview(result);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setPreviewError(
              caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
            );
            setPreview(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPreviewing(false);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, rule?.id, valid]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      if (rule === null) {
        await createScheduleRule(input);
      } else {
        await updateScheduleRule(rule.id, rule.version, {
          daysOfWeek: input.daysOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          classroomId: input.classroomId,
          teacherId: input.teacherId,
        });
      }
      showToast({ message: t('toast.saved'), variant: 'success' });
      onSaved();
    } catch (caught) {
      showToast({
        message:
          caught instanceof ApiError && caught.body.code === 'SCHEDULE_CONFLICT'
            ? t('schedule.error.conflict')
            : caught instanceof ApiError
              ? caught.body.message
              : t('form.error.unknown'),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  const hasConflicts = preview !== null && preview.conflicts.length > 0;

  return (
    <Drawer
      open
      title={rule === null ? t('schedule.rule.add') : t('schedule.rule.edit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="primary"
            // Saving with a known conflict is pointless: the API refuses it
            // (TZ M4.4 makes a room/teacher clash a block, not a warning),
            // so the button says so instead of inviting a 409.
            disabled={saving || !valid || hasConflicts}
            onClick={() => void save()}
          >
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="rule-days" label={t('schedule.rule.field.days')} required>
          <div id="rule-days" className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const on = days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDays(on ? days.filter((value) => value !== day) : [...days, day])
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`schedule.weekday.short.${day}` as TranslationKey)}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field id="rule-start" label={t('schedule.rule.field.startTime')} required>
              <Input
                id="rule-start"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field id="rule-end" label={t('schedule.rule.field.endTime')} required>
              <Input
                id="rule-end"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                aria-invalid={endTime <= startTime}
              />
            </Field>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field id="rule-period-start" label={t('schedule.rule.field.periodStart')} required>
              <Input
                id="rule-period-start"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field id="rule-period-end" label={t('schedule.rule.field.periodEnd')} required>
              <Input
                id="rule-period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                aria-invalid={periodEnd !== '' && periodEnd < periodStart}
              />
            </Field>
          </div>
        </div>

        <Field id="rule-room" label={t('schedule.rule.field.classroom')}>
          <Select
            id="rule-room"
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            <option value="">{t('schedule.lesson.noClassroom')}</option>
            {classrooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="rule-teacher" label={t('schedule.rule.field.teacher')}>
          <Select
            id="rule-teacher"
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
          >
            <option value="">{t('schedule.lesson.noTeacher')}</option>
            {teachers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </Select>
        </Field>

        {/* UX 4.3 step 2's live preview. */}
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <p className="mb-1 font-semibold">{t('schedule.preview.title')}</p>
          {previewError !== null ? (
            <p role="alert" className="text-destructive">
              {previewError}
            </p>
          ) : previewing && preview === null ? (
            <p className="text-muted-foreground">{t('schedule.preview.loading')}</p>
          ) : preview === null ? (
            <p className="text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p>
                <strong>{preview.lessonCount}</strong> {t('schedule.preview.lessons')}
                {preview.firstDate !== null && (
                  <>
                    , {t('schedule.preview.first')} {formatDayNumber(preview.firstDate)}
                  </>
                )}
                {preview.lastDate !== null && (
                  <>
                    , {t('schedule.preview.last')} {formatDayNumber(preview.lastDate)}
                  </>
                )}
              </p>
              {preview.conflicts.length === 0 && preview.skippedHolidays.length === 0 ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  {t('schedule.preview.none')}
                </p>
              ) : (
                <p className={hasConflicts ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}>
                  {t('schedule.preview.conflicts')}:{' '}
                  {preview.conflicts.length + preview.skippedHolidays.length} (
                  {[
                    preview.skippedHolidays.length > 0
                      ? `${t('schedule.preview.holidays')} ${preview.skippedHolidays.length}`
                      : null,
                    preview.conflicts.filter((conflict) => conflict.kind === 'classroom').length > 0
                      ? `${t('schedule.preview.roomBusy')} ${
                          preview.conflicts.filter((conflict) => conflict.kind === 'classroom').length
                        }`
                      : null,
                    preview.conflicts.filter((conflict) => conflict.kind === 'teacher').length > 0
                      ? `${t('schedule.preview.teacherBusy')} ${
                          preview.conflicts.filter((conflict) => conflict.kind === 'teacher').length
                        }`
                      : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(', ')}
                  )
                </p>
              )}

              {/* UX P4: a conflict is answered with suggestions, not just a
                  red message — "Xona 204 band. Boʻsh: 206, 301 · yoki 19:30". */}
              {hasConflicts && preview.alternatives.classrooms.length > 0 && (
                <p className="text-xs">
                  {t('schedule.drag.freeAlternatives')}:{' '}
                  {preview.alternatives.classrooms.map((room) => (
                    <button
                      key={room.classroomId}
                      type="button"
                      className="mr-1 underline hover:no-underline"
                      onClick={() => setClassroomId(room.classroomId)}
                    >
                      {room.classroomName}
                      {room.capacity !== null && room.capacity < enrolledCount ? ' ⚠' : ''}
                    </button>
                  ))}
                </p>
              )}
              {hasConflicts && preview.alternatives.times.length > 0 && (
                <p className="text-xs">
                  {t('schedule.drag.or')}:{' '}
                  {preview.alternatives.times.map((time) => (
                    <button
                      key={time.startTime}
                      type="button"
                      className="mr-1 underline hover:no-underline"
                      onClick={() => {
                        setStartTime(time.startTime);
                        setEndTime(time.endTime);
                      }}
                    >
                      {time.startTime}
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
