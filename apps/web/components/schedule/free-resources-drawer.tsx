'use client';

import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/states/empty-state';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { fetchAvailability, type Availability } from '@/lib/schedule';

/**
 * UX 4.4 "Boʻsh resurslar": "Seshanba 18:00–19:30 da kim va qayer boʻsh?"
 * — pick a slot, get the free classrooms (with their capacity) and the
 * available teachers.
 *
 * Needs a branch: both answers are branch-scoped, and "free somewhere in
 * the company" is not a question anyone asks. With "Barcha filiallar"
 * selected the drawer says so rather than guessing one.
 */
export function FreeResourcesDrawer({
  branchId,
  defaultDate,
  onClose,
}: {
  branchId: string | null;
  defaultDate: string;
  onClose: () => void;
}): JSX.Element {
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');
  const [result, setResult] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(): Promise<void> {
    if (branchId === null) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchAvailability({ date, startTime, endTime, branchId }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.body.message : t('form.error.unknown'));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Drawer
      open
      title={t('schedule.free.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('schedule.action.close')}</Button>
          <Button
            variant="primary"
            disabled={loading || branchId === null || endTime <= startTime}
            onClick={() => void search()}
          >
            {loading ? t('state.loading') : t('schedule.free.search')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {branchId === null && (
          <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('branch.select')}
          </p>
        )}

        <Field id="free-date" label={t('schedule.free.field.date')} required>
          <Input
            id="free-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field id="free-start" label={t('schedule.free.field.startTime')} required>
              <Input
                id="free-start"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field id="free-end" label={t('schedule.free.field.endTime')} required>
              <Input
                id="free-end"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                aria-invalid={endTime <= startTime}
              />
            </Field>
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {result !== null && (
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('schedule.free.classrooms')}</h3>
              {result.alternatives.classrooms.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('schedule.free.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {result.alternatives.classrooms.map((room) => (
                    <li key={room.classroomId} className="flex items-center gap-2">
                      <span>{room.classroomName}</span>
                      {room.capacity !== null && (
                        <span className="text-xs text-muted-foreground">
                          {room.capacity} {t('schedule.free.capacity')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('schedule.free.teachers')}</h3>
              {result.freeTeachers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('schedule.free.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {result.freeTeachers.map((teacher) => (
                    <li key={teacher.teacherId} className="flex items-center gap-2">
                      <span>{teacher.teacherName}</span>
                      {teacher.matchesDiscipline && (
                        <Badge variant="success">{t('schedule.free.matchesDiscipline')}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {result.alternatives.classrooms.length === 0 && result.freeTeachers.length === 0 && (
              <EmptyState title={t('schedule.free.none')} />
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
