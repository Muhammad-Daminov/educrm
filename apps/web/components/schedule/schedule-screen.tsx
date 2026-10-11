'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/branch-provider';
import { useToast } from '@/components/toast-provider';
import { LessonActionsDrawer } from '@/components/schedule/lesson-actions-drawer';
import { FreeResourcesDrawer } from '@/components/schedule/free-resources-drawer';
import { ExtraLessonDrawer } from '@/components/schedule/extra-lesson-drawer';
import { t, type TranslationKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import { fetchActiveOptions } from '@/lib/resources';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  buildWeekGrid,
  classroomPalette,
  conflictSummary,
  conflictSummaryFromError,
  dropTarget,
  fetchAvailability,
  fetchLessons,
  formatClock,
  formatDayNumber,
  gridRows,
  lessonDurationMinutes,
  localTime,
  moveLesson,
  statusClass,
  todayLocal,
  weekDates,
  weekStart,
  type Availability,
  type Lesson,
  type PlacedLesson,
  type ScheduleConflictDetail,
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

/** Pixel height of one grid row — the grid is absolute-positioned inside it. */
const ROW_HEIGHT = 56;

const CONFLICT_LABELS = {
  busy: t('schedule.drag.busy'),
  free: t('schedule.drag.freeAlternatives'),
  or: t('schedule.drag.or'),
  roomBusy: t('schedule.drag.roomBusy'),
  teacherBusy: t('schedule.drag.teacherBusy'),
};

interface DragState {
  lesson: Lesson;
  /** Where the pointer currently is, in grid coordinates. */
  date: string;
  startTime: string;
  endTime: string;
  /** Pointer position in viewport pixels, for the tooltip. */
  x: number;
  y: number;
}

/**
 * TZ M4.6 / UX P4 week calendar: time rows, day columns, lessons coloured by
 * classroom, parallel lessons side by side, today's column highlighted, and
 * drag-to-move with a live conflict tooltip offering free alternatives.
 *
 * The geometry and the colour assignment are not computed here — they come
 * from `lib/schedule.ts`, which is pure and unit-tested. This component
 * handles state, the pointer gesture and the markup.
 */
export function ScheduleScreen(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const { selectedBranchId: contextBranchId } = useBranch();
  const { showToast } = useToast();

  const today = useMemo(() => todayLocal(DEFAULT_TIME_ZONE), []);
  const anchor = searchParams.get('week') ?? today;
  const classroomFilter = searchParams.get('classroom_id') ?? '';
  const teacherFilter = searchParams.get('teacher_id') ?? '';

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomOption[] | null>(null);
  const [teachers, setTeachers] = useState<EmployeeOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<Lesson | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragAvailability, setDragAvailability] = useState<Availability | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Guards the drop handler against a stale availability response. */
  const dragRequestRef = useRef(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const from = dates[0] as string;
  const to = dates[6] as string;

  const canReschedule = hasAnyPermission(me.permissions, ['lesson.reschedule']);
  const canCreate = hasAnyPermission(me.permissions, ['schedule.create']);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchActiveOptions<ClassroomOption>('/api/v1/classrooms'),
      fetchActiveOptions<EmployeeOption>('/api/v1/employees'),
    ])
      .then(([classroomOptions, employeeOptions]) => {
        if (!cancelled) {
          setClassrooms(classroomOptions);
          setTeachers(employeeOptions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Filters are an enhancement; the calendar itself still works.
          setClassrooms([]);
          setTeachers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLessons({
      from,
      to,
      ...(contextBranchId === null ? {} : { branchId: contextBranchId }),
      ...(classroomFilter === '' ? {} : { classroomId: classroomFilter }),
      ...(teacherFilter === '' ? {} : { teacherId: teacherFilter }),
    })
      .then((rows) => {
        if (!cancelled) {
          setLessons(rows);
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
  }, [from, to, contextBranchId, classroomFilter, teacherFilter, reloadToken]);

  const grid = useMemo(
    () => buildWeekGrid(anchor, lessons, today, DEFAULT_TIME_ZONE),
    [anchor, lessons, today],
  );
  const rows = useMemo(() => gridRows(grid.bounds), [grid.bounds]);

  const navigate = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const query = next.toString();
      router.replace(`${pathname}${query === '' ? '' : `?${query}`}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const classroomOptions = useMemo(
    () =>
      (classrooms ?? []).filter(
        (room) => contextBranchId === null || room.branchId === contextBranchId,
      ),
    [classrooms, contextBranchId],
  );

  // ---------------------------------------------------------------------
  // Drag to move
  // ---------------------------------------------------------------------

  /** Grid coordinates for a pointer position, or null if it is outside. */
  const resolveTarget = useCallback(
    (clientX: number, clientY: number, lesson: Lesson) => {
      const body = bodyRef.current;
      if (body === null) {
        return null;
      }
      const rect = body.getBoundingClientRect();
      // Horizontal position picks the day column; the label gutter on the
      // left is outside the body element, so the body's own width maps
      // exactly onto the seven columns.
      const columnWidth = rect.width / 7;
      const index = Math.floor((clientX - rect.left) / columnWidth);
      if (index < 0 || index > 6) {
        return null;
      }
      const ratio = (clientY - rect.top) / rect.height;
      return dropTarget(
        dates[index] as string,
        ratio,
        grid.bounds,
        lessonDurationMinutes(lesson),
      );
    },
    [dates, grid.bounds],
  );

  const onLessonPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, lesson: Lesson) => {
      // Only a plain left-button drag starts a move; anything else (a click
      // to open the actions drawer, a right-click) is left alone.
      if (!canReschedule || event.button !== 0 || lesson.status !== 'planned') {
        return;
      }
      const target = resolveTarget(event.clientX, event.clientY, lesson);
      if (target === null) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ lesson, ...target, x: event.clientX, y: event.clientY });
      setDragAvailability(null);
    },
    [canReschedule, resolveTarget],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag === null) {
        return;
      }
      const target = resolveTarget(event.clientX, event.clientY, drag.lesson);
      if (target === null) {
        return;
      }
      const changed = target.date !== drag.date || target.startTime !== drag.startTime;
      setDrag({ ...drag, ...target, x: event.clientX, y: event.clientY });

      if (!changed) {
        return;
      }
      // UX P4: "ko'chirishda jonli konflikt ko'rsatkichi". One request per
      // distinct slot the pointer passes over, not per pixel — and the
      // sequence number means a slow response for an earlier slot cannot
      // overwrite the tooltip for the current one.
      const sequence = dragRequestRef.current + 1;
      dragRequestRef.current = sequence;
      setDragAvailability(null);
      void fetchAvailability({
        date: target.date,
        startTime: target.startTime,
        endTime: target.endTime,
        branchId: drag.lesson.branchId,
        classroomId: drag.lesson.classroomId,
        teacherId: drag.lesson.actualTeacherId,
        excludeLessonId: drag.lesson.id,
      })
        .then((availability) => {
          if (dragRequestRef.current === sequence) {
            setDragAvailability(availability);
          }
        })
        .catch(() => undefined);
    },
    [drag, resolveTarget],
  );

  const onPointerUp = useCallback(async (): Promise<void> => {
    const current = drag;
    setDrag(null);
    setDragAvailability(null);
    if (current === null) {
      return;
    }
    const unchanged =
      current.date === current.lesson.date &&
      current.startTime === localTime(current.lesson.startAt, DEFAULT_TIME_ZONE);
    if (unchanged) {
      return;
    }

    try {
      await moveLesson(current.lesson.id, current.lesson.version, {
        date: current.date,
        startTime: current.startTime,
      });
      showToast({ message: t('schedule.drag.moved'), variant: 'success' });
      reload();
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
      } else if (caught instanceof ApiError && caught.body.code === 'LESSON_NOT_MUTABLE') {
        showToast({ message: t('schedule.error.notMutable'), variant: 'error' });
      } else {
        showToast({
          message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
          variant: 'error',
        });
      }
      reload();
    }
  }, [drag, reload, showToast]);

  if (classrooms === null || teachers === null) {
    return <LoadingState rows={6} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{t('schedule.title')}</h1>
          <span className="text-sm text-muted-foreground">
            {formatDayNumber(from)} — {formatDayNumber(to)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            aria-label={t('schedule.week.previous')}
            onClick={() => navigate({ week: weekStart(addDays(anchor, -7)) })}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button size="sm" onClick={() => navigate({ week: undefined })}>
            {t('schedule.today')}
          </Button>
          <Button
            size="sm"
            aria-label={t('schedule.week.next')}
            onClick={() => navigate({ week: weekStart(addDays(anchor, 7)) })}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button size="sm" onClick={() => setFreeOpen(true)}>
            <Search className="size-4" aria-hidden="true" />
            {t('schedule.free.open')}
          </Button>
          {canCreate && (
            <Button size="sm" variant="primary" onClick={() => setExtraOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('schedule.action.extra')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-48"
          aria-label={t('schedule.filter.classroom')}
          value={classroomFilter}
          onChange={(event) => navigate({ classroom_id: event.target.value })}
        >
          <option value="">{t('schedule.filter.allClassrooms')}</option>
          {classroomOptions.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          aria-label={t('schedule.filter.teacher')}
          value={teacherFilter}
          onChange={(event) => navigate({ teacher_id: event.target.value })}
        >
          <option value="">{t('schedule.filter.allTeachers')}</option>
          {teachers.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.fullName}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">{t('schedule.legend.classroom')}</span>
        {canReschedule && (
          <span className="text-xs text-muted-foreground">· {t('schedule.drag.hint')}</span>
        )}
      </div>

      {loading ? (
        <LoadingState rows={8} />
      ) : error !== null ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          {lessons.length === 0 && <EmptyState title={t('schedule.empty')} />}

          <div className="overflow-x-auto rounded-lg border border-border">
            <div className="min-w-[56rem]">
              {/* Day column headers */}
              <div className="flex border-b border-border bg-muted/40">
                <div className="w-14 shrink-0 border-r border-border" aria-hidden="true" />
                {grid.days.map((day) => (
                  <div
                    key={day.date}
                    className={`flex-1 border-r border-border px-2 py-2 text-center last:border-r-0 ${
                      day.isToday ? 'bg-primary/10 font-semibold' : ''
                    }`}
                  >
                    <div className="text-xs uppercase text-muted-foreground">
                      {t(`schedule.weekday.short.${isoDayOf(day.date)}` as TranslationKey)}
                    </div>
                    <div className={`text-sm ${day.isToday ? 'text-primary' : ''}`}>
                      {formatDayNumber(day.date)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Time rows + lesson blocks */}
              <div className="flex">
                <div className="w-14 shrink-0 border-r border-border">
                  {rows.map((minute) => (
                    <div
                      key={minute}
                      style={{ height: ROW_HEIGHT }}
                      className="border-b border-border px-1 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground last:border-b-0"
                    >
                      {formatClock(minute)}
                    </div>
                  ))}
                </div>

                <div ref={bodyRef} className="relative flex flex-1">
                  {/* Hour lines, drawn once behind every column. */}
                  <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    {rows.map((minute) => (
                      <div
                        key={minute}
                        style={{ height: ROW_HEIGHT }}
                        className="border-b border-border last:border-b-0"
                      />
                    ))}
                  </div>

                  {grid.days.map((day) => (
                    <div
                      key={day.date}
                      style={{ height: rows.length * ROW_HEIGHT }}
                      className={`relative flex-1 border-r border-border last:border-r-0 ${
                        day.isToday
                          ? 'bg-primary/5'
                          : day.isWeekend
                            ? 'bg-muted/20'
                            : ''
                      }`}
                    >
                      {day.placed.map((placed) => (
                        <LessonBlock
                          key={placed.lesson.id}
                          placed={placed}
                          dragging={drag?.lesson.id === placed.lesson.id}
                          draggable={canReschedule && placed.lesson.status === 'planned'}
                          onOpen={() => setSelected(placed.lesson)}
                          onPointerDown={onLessonPointerDown}
                          onPointerMove={onPointerMove}
                          onPointerUp={() => void onPointerUp()}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {drag !== null && <DragTooltip drag={drag} availability={dragAvailability} />}

      {selected !== null && (
        <LessonActionsDrawer
          lesson={selected}
          classrooms={classroomOptions}
          teachers={teachers}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}

      {freeOpen && (
        <FreeResourcesDrawer
          branchId={contextBranchId}
          defaultDate={today}
          onClose={() => setFreeOpen(false)}
        />
      )}

      {extraOpen && (
        <ExtraLessonDrawer
          classrooms={classroomOptions}
          teachers={teachers}
          defaultDate={today}
          onClose={() => setExtraOpen(false)}
          onCreated={() => {
            setExtraOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function isoDayOf(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * One lesson. A button rather than a div: it is the thing you click to open
 * the actions drawer, so it must be reachable and activatable by keyboard
 * (UX §8.6) even though dragging itself is pointer-only.
 */
function LessonBlock({
  placed,
  dragging,
  draggable,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  placed: PlacedLesson;
  dragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, lesson: Lesson) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
}): JSX.Element {
  const { lesson, top, height, column, columns } = placed;
  const palette = classroomPalette(lesson.classroomId);
  const width = 100 / columns;

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={(event) => onPointerDown(event, lesson)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        top: `${top}%`,
        height: `${height}%`,
        left: `${column * width}%`,
        width: `calc(${width}% - 2px)`,
      }}
      className={`absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight ${palette.block} ${palette.dark} ${statusClass(lesson.status)} ${
        dragging ? 'opacity-40' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} hover:ring-2 hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      title={`${localTime(lesson.startAt)}–${localTime(lesson.endAt)} · ${lesson.studyUnitName} · ${
        lesson.classroomName ?? t('schedule.lesson.noClassroom')
      }`}
    >
      <span className="block font-medium tabular-nums">{localTime(lesson.startAt)}</span>
      <span className="block truncate font-semibold">{lesson.studyUnitName}</span>
      <span className="block truncate opacity-80">
        {lesson.classroomName ?? t('schedule.lesson.noClassroom')}
      </span>
      {lesson.isSubstituted && (
        <span className="block truncate opacity-80">↺ {lesson.actualTeacherName ?? ''}</span>
      )}
    </button>
  );
}

/**
 * UX P4: the live conflict indicator during a drag — red over a busy slot,
 * with the free alternatives spelled out ("Xona 204 band. Boʻsh: 206 · yoki
 * 19:30"). Fixed-positioned next to the pointer so it is readable without
 * covering the slot being targeted.
 */
function DragTooltip({
  drag,
  availability,
}: {
  drag: DragState;
  availability: Availability | null;
}): JSX.Element {
  const busy = availability !== null && !availability.free;
  const summary =
    availability === null ? '' : busy ? conflictSummary(availability, CONFLICT_LABELS) : '';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ left: drag.x + 14, top: drag.y + 14 }}
      className={`pointer-events-none fixed z-50 max-w-xs rounded-md border px-2 py-1.5 text-xs shadow-lg ${
        busy
          ? 'border-red-400 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
          : 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
      }`}
    >
      <div className="font-semibold tabular-nums">
        {formatDayNumber(drag.date)} · {drag.startTime}–{drag.endTime}
      </div>
      {availability === null ? (
        <div className="opacity-70">{t('schedule.preview.loading')}</div>
      ) : busy ? (
        <div>{summary}</div>
      ) : (
        <div>{t('schedule.drag.free')}</div>
      )}
    </div>
  );
}

