'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/toast-provider';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import {
  DEFAULT_TIME_ZONE,
  cancelLesson,
  conflictSummaryFromError,
  localTime,
  moveLesson,
  substituteTeacher,
  type Lesson,
  type ScheduleConflictDetail,
} from '@/lib/schedule';

interface ClassroomOption {
  id: string;
  name: string;
}
interface EmployeeOption {
  id: string;
  fullName: string;
}

type Mode = 'overview' | 'move' | 'cancel' | 'substitute';

const CONFLICT_LABELS = {
  busy: t('schedule.drag.busy'),
  free: t('schedule.drag.freeAlternatives'),
  or: t('schedule.drag.or'),
  roomBusy: t('schedule.drag.roomBusy'),
  teacherBusy: t('schedule.drag.teacherBusy'),
};

/**
 * TZ M4.5 single-lesson actions: move, cancel (with a reason), substitute
 * the teacher. Each is behind its own permission, so the drawer shows only
 * the buttons this user can actually press — the backend is still the one
 * enforcing it (CLAUDE.md).
 */
export function LessonActionsDrawer({
  lesson,
  classrooms,
  teachers,
  onClose,
  onChanged,
}: {
  lesson: Lesson;
  classrooms: readonly ClassroomOption[];
  teachers: readonly EmployeeOption[];
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { me } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>('overview');
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(lesson.date);
  const [startTime, setStartTime] = useState(localTime(lesson.startAt, DEFAULT_TIME_ZONE));
  const [classroomId, setClassroomId] = useState(lesson.classroomId ?? '');
  const [reason, setReason] = useState('');
  const [actualTeacherId, setActualTeacherId] = useState(lesson.actualTeacherId ?? '');

  const canMove = hasAnyPermission(me.permissions, ['lesson.reschedule']);
  const canCancel = hasAnyPermission(me.permissions, ['lesson.cancel']);
  const canSubstitute = hasAnyPermission(me.permissions, ['lesson.substitute_teacher']);
  const mutable = lesson.status === 'planned';

  function report(caught: unknown): void {
    if (caught instanceof ApiError && caught.body.code === 'SCHEDULE_CONFLICT') {
      const detail = (caught.body.details as ScheduleConflictDetail[] | null)?.[0];
      showToast({
        message:
          detail === undefined
            ? t('schedule.error.conflict')
            : conflictSummaryFromError(detail, CONFLICT_LABELS),
        variant: 'error',
      });
    } else if (caught instanceof ApiError && caught.body.code === 'LESSON_NOT_MUTABLE') {
      showToast({ message: t('schedule.error.notMutable'), variant: 'error' });
    } else {
      showToast({
        message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    }
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    setSaving(true);
    try {
      await action();
      showToast({ message: t('toast.saved'), variant: 'success' });
      onChanged();
    } catch (caught) {
      report(caught);
    } finally {
      setSaving(false);
    }
  }

  const title =
    mode === 'move'
      ? t('schedule.move.title')
      : mode === 'cancel'
        ? t('schedule.cancel.title')
        : mode === 'substitute'
          ? t('schedule.substitute.title')
          : lesson.studyUnitName;

  return (
    <Drawer
      open
      title={title}
      description={`${lesson.date} · ${localTime(lesson.startAt)}–${localTime(lesson.endAt)}`}
      onClose={onClose}
      footer={
        mode === 'overview' ? (
          <Button onClick={onClose}>{t('schedule.action.close')}</Button>
        ) : (
          <>
            <Button onClick={() => setMode('overview')} disabled={saving}>
              {t('form.cancel')}
            </Button>
            <Button
              variant={mode === 'cancel' ? 'danger' : 'primary'}
              disabled={saving || (mode === 'cancel' && reason.trim() === '')}
              onClick={() => {
                if (mode === 'move') {
                  void run(() =>
                    moveLesson(lesson.id, lesson.version, {
                      date,
                      startTime,
                      classroomId: classroomId === '' ? null : classroomId,
                      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
                    }),
                  );
                } else if (mode === 'cancel') {
                  void run(() => cancelLesson(lesson.id, lesson.version, reason.trim()));
                } else {
                  void run(() =>
                    substituteTeacher(
                      lesson.id,
                      lesson.version,
                      actualTeacherId === '' ? null : actualTeacherId,
                      reason.trim() === '' ? undefined : reason.trim(),
                    ),
                  );
                }
              }}
            >
              {saving ? t('form.saving') : t('form.save')}
            </Button>
          </>
        )
      }
    >
      {mode === 'overview' ? (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 text-sm">
            <Row label={t('schedule.filter.classroom')}>
              {lesson.classroomName ?? t('schedule.lesson.noClassroom')}
            </Row>
            <Row label={t('schedule.filter.teacher')}>
              {lesson.actualTeacherName ?? t('schedule.lesson.noTeacher')}
              {lesson.isSubstituted && (
                <Badge className="ml-2" variant="warning">
                  {t('schedule.lesson.substituted')}
                </Badge>
              )}
            </Row>
            {lesson.topic !== null && lesson.topic !== '' && (
              <Row label={t('schedule.extra.field.topic')}>{lesson.topic}</Row>
            )}
            {lesson.cancelReason !== null && (
              <Row label={t('schedule.cancel.field.reason')}>{lesson.cancelReason}</Row>
            )}
          </dl>

          <div className="flex flex-wrap gap-2">
            {lesson.status === 'cancelled' && (
              <Badge variant="destructive">{t('schedule.lesson.cancelled')}</Badge>
            )}
            {lesson.isDetached && lesson.status === 'planned' && (
              <Badge variant="warning">{t('schedule.lesson.detached')}</Badge>
            )}
            {lesson.attendanceCount > 0 && (
              <Badge variant="success">{t('schedule.lesson.attendanceMarked')}</Badge>
            )}
          </div>

          <Link
            href={`/units/${lesson.studyUnitId}`}
            className="w-fit text-sm text-primary hover:underline"
          >
            {lesson.studyUnitName}
          </Link>

          {mutable && (
            <div className="flex flex-wrap gap-2">
              {canMove && (
                <Button size="sm" onClick={() => setMode('move')}>
                  {t('schedule.action.move')}
                </Button>
              )}
              {canSubstitute && (
                <Button size="sm" onClick={() => setMode('substitute')}>
                  {t('schedule.action.substitute')}
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="danger" onClick={() => setMode('cancel')}>
                  {t('schedule.action.cancel')}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : mode === 'move' ? (
        <div className="flex flex-col gap-4">
          <Field id="move-date" label={t('schedule.move.field.date')} required>
            <Input
              id="move-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field id="move-start" label={t('schedule.move.field.startTime')} required>
            <Input
              id="move-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </Field>
          <Field id="move-room" label={t('schedule.move.field.classroom')}>
            <Select
              id="move-room"
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
          <Field id="move-reason" label={t('schedule.move.field.reason')}>
            <Textarea
              id="move-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      ) : mode === 'cancel' ? (
        <Field
          id="cancel-reason"
          label={t('schedule.cancel.field.reason')}
          hint={t('schedule.cancel.field.reason.hint')}
          required
        >
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-4">
          <Field id="sub-teacher" label={t('schedule.substitute.field.teacher')}>
            <Select
              id="sub-teacher"
              value={actualTeacherId}
              onChange={(event) => setActualTeacherId(event.target.value)}
            >
              <option value="">{t('schedule.substitute.none')}</option>
              {teachers.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="sub-reason" label={t('schedule.move.field.reason')}>
            <Textarea
              id="sub-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      )}
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
