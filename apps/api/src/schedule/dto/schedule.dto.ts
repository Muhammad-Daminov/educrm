import { z } from 'zod';

/**
 * TZ M4.3–M4.5. Shapes for schedule rules and the single-lesson actions.
 *
 * The two-mode invariants (duration from `endTime` *or*
 * `academicHoursPerDay`; extent from `periodEnd` *or*
 * `totalAcademicHours`) are checked here *and* by CHECK constraints in the
 * migration. Both on purpose: the DTO gives a field-level 400
 * VALIDATION_ERROR the form can attach to an input (UX P6), the constraint
 * is what makes the invariant true for every writer, including a future job
 * or a hand-run SQL fix.
 */

const isoDate = z.string().trim().date();

/** `HH:MM`, 24-hour — the same format the column's CHECK constraint pins. */
const clockTime = z
  .string()
  .trim()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Expected HH:MM');

/** ISO-8601 weekday numbers, 1 = Monday ... 7 = Sunday. */
const daysOfWeek = z
  .array(z.coerce.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, { message: 'Duplicate weekday' });

const scheduleRuleBody = z.object({
  studyUnitId: z.string().uuid(),
  daysOfWeek,
  startTime: clockTime,
  endTime: clockTime.nullable().optional(),
  academicHoursPerDay: z.coerce.number().positive().max(24).nullable().optional(),
  breakMinutes: z.coerce.number().int().min(0).max(23 * 60).default(0),
  periodStart: isoDate,
  periodEnd: isoDate.nullable().optional(),
  totalAcademicHours: z.coerce.number().positive().max(10_000).nullable().optional(),
  classroomId: z.string().uuid().nullable().optional(),
  teacherId: z.string().uuid().nullable().optional(),
});

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** The two TZ M4.3 "yoki" invariants, shared by create and preview. */
function refineRuleModes<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema
    .refine(
      (dto: z.infer<T>) => isSet(dto.endTime) !== isSet(dto.academicHoursPerDay),
      {
        message: 'Provide exactly one of endTime or academicHoursPerDay',
        path: ['endTime'],
      },
    )
    .refine((dto: z.infer<T>) => isSet(dto.periodEnd) || isSet(dto.totalAcademicHours), {
      message: 'Provide periodEnd or totalAcademicHours',
      path: ['periodEnd'],
    })
    .refine(
      (dto: z.infer<T>) =>
        !isSet(dto.endTime) || !isSet(dto.startTime) || dto.endTime > dto.startTime,
      { message: 'endTime must be after startTime', path: ['endTime'] },
    )
    .refine(
      (dto: z.infer<T>) =>
        !isSet(dto.periodEnd) || !isSet(dto.periodStart) || dto.periodEnd >= dto.periodStart,
      { message: 'periodEnd must not be before periodStart', path: ['periodEnd'] },
    ) as unknown as z.ZodEffects<T>;
}

export const createScheduleRuleSchema = refineRuleModes(scheduleRuleBody);
export type CreateScheduleRuleDto = z.infer<typeof scheduleRuleBody>;

/**
 * TZ M4.3 (SHART): "POST /schedule-rules/:id/preview — saqlashdan oldin
 * natija va konfliktlar roʻyxati". Takes a whole rule body so the group
 * wizard can preview a rule that does not exist yet (UX 4.3 step 2's live
 * "24 dars, birinchisi 14.10 ... Konflikt: 2"), which is the case the spec
 * actually cares about — previewing only a saved rule would be useless
 * there. `:id` in the path, when given, is the rule being *replaced*, whose
 * own lessons must not count as conflicts against itself.
 */
export const previewScheduleRuleSchema = createScheduleRuleSchema;
export type PreviewScheduleRuleDto = CreateScheduleRuleDto;

/**
 * A rule edit regenerates future lessons (TZ M4.3). `studyUnitId` is not
 * updatable — pointing a rule at a different group is "make a new rule",
 * and silently moving a group's whole schedule is not an edit anyone means.
 *
 * Deliberately *not* wrapped in `refineRuleModes`: those two invariants are
 * properties of the whole rule, and a PATCH body carries only the fields
 * being changed. Applying them here would reject `{ startTime: "10:00" }`
 * for "providing neither periodEnd nor totalAcademicHours" — fields the
 * caller never meant to touch. The service merges the patch onto the stored
 * rule and validates *that* against `createScheduleRuleSchema`
 * (`assertMergedRuleValid`), which is the object the invariants are about.
 */
export const updateScheduleRuleSchema = scheduleRuleBody
  .omit({ studyUnitId: true })
  .partial()
  .extend({
    breakMinutes: z.coerce.number().int().min(0).max(23 * 60).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateScheduleRuleDto = z.infer<typeof updateScheduleRuleSchema>;

export const scheduleRuleListQuerySchema = z.object({
  study_unit_id: z.string().uuid().optional(),
  is_active: z.enum(['true', 'false', 'all']).default('true'),
});

export type ScheduleRuleListQueryDto = z.infer<typeof scheduleRuleListQuerySchema>;

/**
 * TZ M4.6 calendar views. `from`/`to` are local calendar dates, inclusive —
 * a week view asks for Monday..Sunday and means the days as the branch sees
 * them, not a UTC instant range.
 */
export const lessonListQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    branch_id: z.string().uuid().optional(),
    classroom_id: z.string().uuid().optional(),
    teacher_id: z.string().uuid().optional(),
    study_unit_id: z.string().uuid().optional(),
    /** Cancelled lessons are shown struck through (UX P4), so default on. */
    include_cancelled: z.enum(['true', 'false']).default('true'),
    limit: z.coerce.number().int().positive().max(2_000).default(1_000),
  })
  .refine((query) => query.to >= query.from, { message: 'to must not be before from', path: ['to'] });

export type LessonListQueryDto = z.infer<typeof lessonListQuerySchema>;

/**
 * TZ M4.5 "bitta darsni koʻchirish". A move does not mutate the lesson in
 * place: the old row becomes `moved` and points at a new row via
 * `moved_to_lesson_id`. That is what lets the exclusion constraint release
 * the old slot (it excludes `moved`) while keeping the history and any
 * attendance already attached to the original.
 */
export const moveLessonSchema = z.object({
  date: isoDate,
  startTime: clockTime,
  /** Omitted keeps the original length. */
  endTime: clockTime.optional(),
  classroomId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(2000).optional(),
});

export type MoveLessonDto = z.infer<typeof moveLessonSchema>;

/** TZ M4.5: "bekor qilish (sabab bilan)" — the reason is mandatory. */
export const cancelLessonSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export type CancelLessonDto = z.infer<typeof cancelLessonSchema>;

/**
 * TZ M4.5 "oʻqituvchini almashtirish". Writes `actual_teacher_id` only —
 * `teacher_id` keeps saying who was scheduled, which is what makes the
 * substitution visible at all, and TZ M4.4 is explicit that conflicts and
 * payroll follow the actual teacher.
 */
export const substituteTeacherSchema = z.object({
  actualTeacherId: z.string().uuid().nullable(),
  reason: z.string().trim().max(2000).optional(),
});

export type SubstituteTeacherDto = z.infer<typeof substituteTeacherSchema>;

/** TZ M4.5 "qoʻshimcha dars" / "qayta dars (makeup)". */
export const createLessonSchema = z
  .object({
    studyUnitId: z.string().uuid(),
    date: isoDate,
    startTime: clockTime,
    endTime: clockTime,
    classroomId: z.string().uuid().nullable().optional(),
    teacherId: z.string().uuid().nullable().optional(),
    makeupForLessonId: z.string().uuid().nullable().optional(),
    topic: z.string().trim().max(500).nullable().optional(),
  })
  .refine((dto) => dto.endTime > dto.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });

export type CreateLessonDto = z.infer<typeof createLessonSchema>;

/**
 * UX 4.4 "Boʻsh resurslar: 'Seshanba 18:00–19:30 da kim va qayer boʻsh?'"
 * and the live conflict tooltip the drag gesture needs. A GET (not a POST)
 * because it is fired on every drag-over: it writes nothing, needs no CSRF
 * token, and is cacheable per slot.
 */
export const availabilityQuerySchema = z
  .object({
    date: isoDate,
    start_time: clockTime,
    end_time: clockTime,
    branch_id: z.string().uuid(),
    /** Checked for a conflict, and excluded from the free-classroom list. */
    classroom_id: z.string().uuid().optional(),
    teacher_id: z.string().uuid().optional(),
    /** The lesson being dragged — it must not conflict with itself. */
    exclude_lesson_id: z.string().uuid().optional(),
    /** Only offer classrooms that seat at least this many (UX 4.4). */
    min_capacity: z.coerce.number().int().min(0).optional(),
    /** Ranks teachers qualified in this discipline first (UX 4.4 "fan"). */
    discipline_id: z.string().uuid().optional(),
  })
  .refine((query) => query.end_time > query.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  });

export type AvailabilityQueryDto = z.infer<typeof availabilityQuerySchema>;
