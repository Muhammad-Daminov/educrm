'use client';

import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/toast-provider';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { fetchActiveOptions } from '@/lib/resources';
import {
  conflictSummaryFromError,
  createExtraLesson,
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
interface UnitOption {
  id: string;
  name: string;
}

const CONFLICT_LABELS = {
  busy: t('schedule.drag.busy'),
  free: t('schedule.drag.freeAlternatives'),
  or: t('schedule.drag.or'),
  roomBusy: t('schedule.drag.roomBusy'),
  teacherBusy: t('schedule.drag.teacherBusy'),
};

/**
 * TZ M4.5 "qoʻshimcha dars" — a one-off lesson outside any rule. The API
 * always marks these `is_detached`, so a later regeneration of the group's
 * rule leaves them alone.
 */
export function ExtraLessonDrawer({
  classrooms,
  teachers,
  defaultDate,
  onClose,
  onCreated,
}: {
  classrooms: readonly ClassroomOption[];
  teachers: readonly EmployeeOption[];
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const { showToast } = useToast();

  const [units, setUnits] = useState<UnitOption[]>([]);
  const [studyUnitId, setStudyUnitId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');
  const [classroomId, setClassroomId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchActiveOptions<UnitOption>('/api/v1/study-units')
      .then(setUnits)
      .catch(() => undefined);
  }, []);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await createExtraLesson({
        studyUnitId,
        date,
        startTime,
        endTime,
        classroomId: classroomId === '' ? null : classroomId,
        teacherId: teacherId === '' ? null : teacherId,
        topic: topic.trim() === '' ? null : topic.trim(),
      });
      showToast({ message: t('toast.saved'), variant: 'success' });
      onCreated();
    } catch (caught) {
      if (caught instanceof ApiError && caught.body.code === 'SCHEDULE_CONFLICT') {
        const detail = (caught.body.details as ScheduleConflictDetail[] | null)?.[0];
        showToast({
          message:
            detail === undefined
              ? t('schedule.error.conflict')
              : conflictSummaryFromError(detail, CONFLICT_LABELS),
          variant: 'error',
        });
      } else {
        showToast({
          message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
          variant: 'error',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const valid = studyUnitId !== '' && endTime > startTime;

  return (
    <Drawer
      open
      title={t('schedule.extra.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" disabled={saving || !valid} onClick={() => void save()}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="extra-unit" label={t('schedule.extra.field.unit')} required>
          <Select
            id="extra-unit"
            value={studyUnitId}
            onChange={(event) => setStudyUnitId(event.target.value)}
          >
            <option value="">{t('form.select.empty')}</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="extra-date" label={t('schedule.extra.field.date')} required>
          <Input
            id="extra-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field id="extra-start" label={t('schedule.extra.field.startTime')} required>
              <Input
                id="extra-start"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field id="extra-end" label={t('schedule.extra.field.endTime')} required>
              <Input
                id="extra-end"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                aria-invalid={endTime <= startTime}
              />
            </Field>
          </div>
        </div>
        <Field id="extra-room" label={t('schedule.move.field.classroom')}>
          <Select
            id="extra-room"
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
        <Field id="extra-teacher" label={t('schedule.filter.teacher')}>
          <Select
            id="extra-teacher"
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
        <Field id="extra-topic" label={t('schedule.extra.field.topic')}>
          <Input
            id="extra-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
        </Field>
      </div>
    </Drawer>
  );
}
