-- ---------------------------------------------------------------------------
-- T07 — study_units + enrollments (TZ M4.1 / M4.2)
--
-- Tables: study_units, enrollments.
--
-- Scope decisions (see docs/QUESTIONS.md for the full writeup):
--  1. No `default_price_id`/`price_id`/`curriculum_id` columns — prices are
--     T10 scope, nothing in R0 reads a curriculum.
--  2. No `contract_id`/`payer_client_id`/`discount_ids` on enrollments —
--     contracts and discounts are T10/T11.
--  3. BR-U1/BR-U2 (no lessons while forming; forming->active requires a
--     schedule rule) are not enforced here — schedule_rules/lessons are T08
--     and do not exist yet. forming->active is allowed unconditionally.
--  4. BR-E3: enrollments are never hard-deleted via the API, only
--     cancelled — no DELETE endpoint exists.
-- ---------------------------------------------------------------------------

-- btree_gist is required for the EXCLUDE USING gist constraint below: it
-- adds the `=` operator class for uuid (and other scalar types) to GiST, so
-- a GiST index can enforce equality on student_id/study_unit_id alongside
-- the daterange overlap check in the same constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "StudyUnitType" AS ENUM ('group', 'mini_group', 'individual');

-- CreateEnum
CREATE TYPE "StudyUnitStatus" AS ENUM ('forming', 'active', 'paused', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'frozen', 'finished', 'transferred', 'cancelled');

-- CreateTable
CREATE TABLE "study_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "discipline_id" UUID NOT NULL,
    "level_id" UUID,
    "age_category_id" UUID,
    "type" "StudyUnitType" NOT NULL,
    "status" "StudyUnitStatus" NOT NULL DEFAULT 'forming',
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "min_size" INTEGER NOT NULL,
    "responsible_id" UUID,
    "color" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- (tenant_id, id) unique keys, created before the foreign keys below that
-- target them as a composite.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "study_units_tenant_id_id_key" ON "study_units"("tenant_id", "id");
CREATE UNIQUE INDEX "enrollments_tenant_id_id_key" ON "enrollments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_tenant_id_discipline_id_fkey" FOREIGN KEY ("tenant_id", "discipline_id") REFERENCES "disciplines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_tenant_id_level_id_fkey" FOREIGN KEY ("tenant_id", "level_id") REFERENCES "levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Plain `id` FK, not the composite (tenant_id, id) pattern: `age_categories`
-- has no (tenant_id, id) unique index (same carve-out as students.import_batch_id).
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_age_category_id_fkey" FOREIGN KEY ("age_category_id") REFERENCES "age_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_tenant_id_responsible_id_fkey" FOREIGN KEY ("tenant_id", "responsible_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_study_unit_id_fkey" FOREIGN KEY ("tenant_id", "study_unit_id") REFERENCES "study_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- name_key: the TZ 8.5 comparison/sort key, same function as every other
-- name_key column (uz_search_key already exists in this database).
-- ---------------------------------------------------------------------------
ALTER TABLE "study_units" ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;

-- ---------------------------------------------------------------------------
-- Remaining indexes
-- ---------------------------------------------------------------------------
CREATE INDEX "study_units_tenant_id_branch_id_status_idx" ON "study_units"("tenant_id", "branch_id", "status");
CREATE INDEX "study_units_tenant_id_name_key_idx" ON "study_units"("tenant_id", "name_key");

CREATE INDEX "enrollments_tenant_id_study_unit_id_status_idx" ON "enrollments"("tenant_id", "study_unit_id", "status");
CREATE INDEX "enrollments_tenant_id_student_id_status_idx" ON "enrollments"("tenant_id", "student_id", "status");

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "study_units"
  ADD CONSTRAINT "study_units_capacity_positive" CHECK ("capacity" > 0);

ALTER TABLE "study_units"
  ADD CONSTRAINT "study_units_min_size_non_negative" CHECK ("min_size" >= 0);

ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_date_range_valid"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- ---------------------------------------------------------------------------
-- BR-E1 (SHART): one (student_id, study_unit_id) pair can never hold two
-- enrollments with overlapping date ranges. A plain UNIQUE/application
-- check race-loses to a concurrent request; the database is the only thing
-- that can guarantee this under concurrency.
--
-- `end_date` NULL (open-ended) is handled by `daterange(..., '[]')`, whose
-- upper bound is simply unbounded when the second argument is NULL — no
-- special-casing needed.
-- ---------------------------------------------------------------------------
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_no_overlap"
  EXCLUDE USING gist (
    "student_id" WITH =,
    "study_unit_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- Row-Level Security — the standard pattern (CLAUDE.md "Non-negotiable"),
-- covered by test/integration/rls-study-units.spec.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "study_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "study_units" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "study_units"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "enrollments"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
