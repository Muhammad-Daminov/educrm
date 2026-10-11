-- ---------------------------------------------------------------------------
-- T08 — schedule_rules + lessons (TZ M4.3 / M4.4 / M4.5 / M4.7)
--
-- Tables: schedule_rules, lessons.
--
-- Scope decisions (full writeup in docs/QUESTIONS.md):
--  1. `lessons.topic_id` (TZ 5.1) is omitted — it points at
--     `curriculum_topics`, and nothing in R0 reads a curriculum (same
--     carve-out T07 made for `study_units.curriculum_id`). The free-text
--     `topic` column is here, so the teacher-facing field works today.
--  2. `schedule_rules.start_time`/`end_time` are TEXT `HH:MM` rather than
--     Postgres `time`. Prisma Client has no time-only scalar: `@db.Time`
--     surfaces as a `DateTime` pinned to 1970-01-01, which every read and
--     write then has to un-mangle, and which silently shifts under a
--     non-UTC client timezone. `HH:MM` text is exactly what the wire format
--     and the UI already use, sorts correctly, is CHECK-constrained to a
--     real clock time below, and casts to `time` with `::time` wherever SQL
--     needs real time arithmetic.
--  3. `days_of_week` holds ISO-8601 weekday numbers (1 = Monday ...
--     7 = Sunday), matching TZ's `int[]`.
-- ---------------------------------------------------------------------------

-- CreateEnum
--
-- TZ M4.4/M4.7. `moved` is the old lesson left behind by a reschedule: it
-- keeps its row (so `moved_to_lesson_id` is a readable history and
-- attendance already attached to it is not orphaned) but is excluded from
-- the conflict constraints below, which is the v1.0 bug TZ M4.4 calls out
-- as fixed — a moved lesson used to keep its old slot "busy" forever.
CREATE TYPE "LessonStatus" AS ENUM ('planned', 'completed', 'cancelled', 'moved');

-- CreateTable
CREATE TABLE "schedule_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "days_of_week" SMALLINT[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT,
    "academic_hours_per_day" DECIMAL(5,2),
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "period_start" DATE NOT NULL,
    "period_end" DATE,
    "total_academic_hours" DECIMAL(7,2),
    "classroom_id" UUID,
    "teacher_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "schedule_rule_id" UUID,
    "date" DATE NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "classroom_id" UUID,
    "teacher_id" UUID,
    -- TZ M4.4 (TUZATILDI): the teacher conflict and payroll both key off
    -- `actual_teacher_id`, not `teacher_id` — otherwise a substitute's own
    -- schedule is unprotected. Defaulted to `teacher_id` by the service.
    "actual_teacher_id" UUID,
    "status" "LessonStatus" NOT NULL DEFAULT 'planned',
    -- TZ M4.3 (SHART): a hand-edited lesson is never overwritten by
    -- regeneration.
    "is_detached" BOOLEAN NOT NULL DEFAULT false,
    "academic_hours" DECIMAL(5,2),
    "topic" TEXT,
    "homework" TEXT,
    "notes" TEXT,
    "makeup_for_lesson_id" UUID,
    "moved_to_lesson_id" UUID,
    "cancel_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by" UUID,
    -- TZ M4.3 (SHART): "a lesson with attendance or a charge is never
    -- auto-deleted". Neither `attendances` (T09) nor `lesson_charges` (T10)
    -- exists yet, so the protection cannot be a join today — and leaving it
    -- unenforced until T09 would mean regeneration is destructive for a
    -- whole task. This counter is the seam: T09 maintains it in the same
    -- transaction as every attendance write, and both the regeneration
    -- query and the DELETE guard trigger below already honour it. T10 adds
    -- its own column for charges the same way. See docs/QUESTIONS.md.
    "attendance_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- (tenant_id, id) unique keys, created before the composite foreign keys.
--
-- `classrooms` is the one existing table that never needed its own: nothing
-- referenced a classroom until now, so the T05 migration only gave it the
-- plain primary key. Both new tables point at it with the standard
-- composite FK (which is what makes "a lesson's classroom belongs to the
-- lesson's tenant" structural rather than policy-dependent — the exclusion
-- constraints below rely on exactly that), so it gets one here.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "classrooms_tenant_id_id_key" ON "classrooms"("tenant_id", "id");

CREATE UNIQUE INDEX "schedule_rules_tenant_id_id_key" ON "schedule_rules"("tenant_id", "id");
CREATE UNIQUE INDEX "lessons_tenant_id_id_key" ON "lessons"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_tenant_id_study_unit_id_fkey" FOREIGN KEY ("tenant_id", "study_unit_id") REFERENCES "study_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_tenant_id_teacher_id_fkey" FOREIGN KEY ("tenant_id", "teacher_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_study_unit_id_fkey" FOREIGN KEY ("tenant_id", "study_unit_id") REFERENCES "study_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_schedule_rule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_rule_id") REFERENCES "schedule_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_classroom_id_fkey" FOREIGN KEY ("tenant_id", "classroom_id") REFERENCES "classrooms"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_teacher_id_fkey" FOREIGN KEY ("tenant_id", "teacher_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_actual_teacher_id_fkey" FOREIGN KEY ("tenant_id", "actual_teacher_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_completed_by_fkey" FOREIGN KEY ("tenant_id", "completed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_makeup_for_lesson_id_fkey" FOREIGN KEY ("tenant_id", "makeup_for_lesson_id") REFERENCES "lessons"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_moved_to_lesson_id_fkey" FOREIGN KEY ("tenant_id", "moved_to_lesson_id") REFERENCES "lessons"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes — TZ M4.6 names the first three as SHART, TZ 5.2 adds the fourth
-- (the nightly horizon-extension job and the "unmarked lessons" list both
-- scan planned lessons by date).
-- ---------------------------------------------------------------------------
CREATE INDEX "lessons_tenant_id_study_unit_id_start_at_idx" ON "lessons"("tenant_id", "study_unit_id", "start_at");
CREATE INDEX "lessons_tenant_id_actual_teacher_id_start_at_idx" ON "lessons"("tenant_id", "actual_teacher_id", "start_at");
CREATE INDEX "lessons_tenant_id_classroom_id_start_at_idx" ON "lessons"("tenant_id", "classroom_id", "start_at");
CREATE INDEX "lessons_tenant_id_date_idx" ON "lessons"("tenant_id", "date") WHERE "status" = 'planned';
CREATE INDEX "lessons_tenant_id_schedule_rule_id_date_idx" ON "lessons"("tenant_id", "schedule_rule_id", "date");

CREATE INDEX "schedule_rules_tenant_id_study_unit_id_idx" ON "schedule_rules"("tenant_id", "study_unit_id");

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------

-- `HH:MM`, 24-hour. Decision 2 at the top of this file explains why these
-- are TEXT; this is what keeps them a real clock time regardless.
ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_start_time_format"
  CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_end_time_format"
  CHECK ("end_time" IS NULL OR "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_time_order"
  CHECK ("end_time" IS NULL OR "end_time" > "start_time");

-- `coalesce(array_length(...), 0)`, not a bare comparison: `array_length`
-- returns NULL for the empty array `{}`, and `NULL >= 1` is NULL, which a
-- CHECK constraint accepts (it only rejects FALSE). Without the coalesce
-- this clause silently permits a rule that meets on no day at all — which
-- generates no lessons and makes a group look broken for no visible
-- reason. `IS NOT NULL` is here for the same class of reason.
ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_days_of_week_valid"
  CHECK (
    "days_of_week" IS NOT NULL
    AND coalesce(array_length("days_of_week", 1), 0) >= 1
    AND "days_of_week" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  );

-- TZ M4.3: "start_time, end_time **yoki** academic_hours_per_day" — the
-- lesson's length comes from one of the two, so exactly one must be set.
ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_duration_source"
  CHECK (("end_time" IS NOT NULL) <> ("academic_hours_per_day" IS NOT NULL));

-- TZ M4.3: "period_start/end **yoki** total_academic_hours" — the horizon
-- needs an end, from one of the two. Both at once is allowed (a total-hours
-- course that also must not run past a date).
ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_period_end_source"
  CHECK ("period_end" IS NOT NULL OR "total_academic_hours" IS NOT NULL);

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_period_order"
  CHECK ("period_end" IS NULL OR "period_end" >= "period_start");

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_break_minutes_non_negative"
  CHECK ("break_minutes" >= 0 AND "break_minutes" < 24 * 60);

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_academic_hours_positive"
  CHECK ("academic_hours_per_day" IS NULL OR "academic_hours_per_day" > 0);

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_total_hours_positive"
  CHECK ("total_academic_hours" IS NULL OR "total_academic_hours" > 0);

ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_time_order" CHECK ("end_at" > "start_at");

ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_attendance_count_non_negative" CHECK ("attendance_count" >= 0);

-- A cancelled lesson must say why (TZ M4.5: "bekor qilish (sabab bilan)").
ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_cancel_reason_required"
  CHECK ("status" <> 'cancelled' OR "cancel_reason" IS NOT NULL);

-- A lesson cannot be its own predecessor/successor.
ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_no_self_reference"
  CHECK ("moved_to_lesson_id" <> "id" AND "makeup_for_lesson_id" <> "id");

-- ---------------------------------------------------------------------------
-- TZ M4.4 (kritik) — conflict control in the database, copied from the spec.
--
-- Why here and not in the service: "SELECT ... overlaps" followed by INSERT
-- is a race, and two concurrent requests both pass it. An exclusion
-- constraint closes it completely. The application check still exists, but
-- only to turn this violation into a SCHEDULE_CONFLICT body carrying free
-- alternatives (UX P4: "Konflikt bo'lsa: xato emas, yechim taklifi").
--
-- The `status NOT IN ('cancelled','moved')` filter is the v1.0 fix TZ M4.4
-- documents: a cancelled or moved-away lesson must stop reserving its slot.
--
-- These constraints are deliberately NOT keyed on `tenant_id`. They don't
-- need to be: `classroom_id` and `actual_teacher_id` are uuidv7 primary
-- keys, and the composite foreign keys above make a lesson's classroom and
-- teacher provably belong to the lesson's own tenant — so two tenants can
-- never present the same id and a cross-tenant false conflict is
-- structurally impossible. Note that RLS does *not* scope constraint
-- checking (the index is shared), which is exactly why this has to hold
-- structurally rather than by policy.
--
-- btree_gist (added by the T07 migration) supplies the uuid `=` operator
-- class GiST needs alongside the tstzrange overlap.
-- ---------------------------------------------------------------------------
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_classroom_no_overlap"
  EXCLUDE USING gist ("classroom_id" WITH =, tstzrange("start_at", "end_at") WITH &&)
  WHERE ("status" NOT IN ('cancelled', 'moved') AND "classroom_id" IS NOT NULL);

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_no_overlap"
  EXCLUDE USING gist ("actual_teacher_id" WITH =, tstzrange("start_at", "end_at") WITH &&)
  WHERE ("status" NOT IN ('cancelled', 'moved') AND "actual_teacher_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- TZ M4.3 (SHART): "Davomati yoki yechimi bor dars avtomatik o'chirilmaydi"
-- — a lesson carrying attendance (or, from T10, a charge) is never
-- auto-deleted.
--
-- Regeneration already filters these rows out of its DELETE (see
-- `ScheduleService.regenerateFuture`), so this trigger should never fire in
-- normal operation. It exists because "should never" is not a guarantee:
-- a future caller, a migration, or a bug in the filter would otherwise
-- destroy attendance history silently, and the data it protects cannot be
-- reconstructed. Same stance as the `ledger_entries` append-only trigger.
--
-- A `completed` lesson is protected for the same reason: completion is what
-- the T10 charge engine keys off (TZ M6.6), so deleting one would strand a
-- charge even before `lesson_charges` exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lessons_refuse_protected_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.attendance_count > 0 THEN
    RAISE EXCEPTION
      'lesson % has attendance and cannot be deleted (TZ M4.3); cancel it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION
      'lesson % is completed and cannot be deleted (TZ M4.3); cancel it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER lessons_refuse_protected_delete
  BEFORE DELETE ON "lessons"
  FOR EACH ROW EXECUTE FUNCTION lessons_refuse_protected_delete();

-- ---------------------------------------------------------------------------
-- Row-Level Security — the standard pattern (CLAUDE.md "Non-negotiable"),
-- covered by test/integration/rls-schedule.spec.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "schedule_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_rules" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "schedule_rules"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lessons" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "lessons"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
