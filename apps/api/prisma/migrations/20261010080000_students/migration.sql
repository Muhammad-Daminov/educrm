-- ---------------------------------------------------------------------------
-- T06 — students (TZ M3)
--
-- Tables: clients, client_phones, contact_persons, students, import_batches.
--
-- Scope decisions (see docs/QUESTIONS.md for the full writeup):
--  1. No `households` table — nothing in T06 needs multi-child billing yet
--     (that's T10+); adding `clients.household_id` later is additive.
--  2. `contact_persons` points at `students` directly, not at `clients` via
--     the TZ 5.1 `contact_person_students` join table — BR-S1 means that
--     join only buys sharing one contact across unrelated client records,
--     which nothing in R0 asks for.
--  3. No `merged_into_id` on `students` — BR-S4 (merge) is out of scope for
--     T06; an unused nullable FK is dead weight until the merge flow exists.
--  4. `students.import_batch_id` is an addition beyond the TZ 5.1 column
--     list: `import_batches` needs it to know which rows to archive on
--     rollback (TZ M11.1 SHART).
--
-- `tenant_id` is denormalized onto `client_phones` and `contact_persons`
-- (not in the TZ 5.1 column list for either) so every tenant-scoped table
-- gets the exact same RLS policy (CLAUDE.md) instead of one that joins
-- through a parent to find the tenant.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('active', 'frozen', 'finished', 'no_enrollment', 'archived');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('students');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "birth_date" DATE,
    "gender" "Gender",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_phones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "phone_e164" TEXT,
    "email" TEXT,
    "is_bill_recipient" BOOLEAN NOT NULL DEFAULT false,
    "receives_notifications" BOOLEAN NOT NULL DEFAULT true,
    "telegram_chat_id" TEXT,
    "telegram_blocked_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'no_enrollment',
    "owner_id" UUID,
    "cached_balance" BIGINT NOT NULL DEFAULT 0,
    "churn_score" SMALLINT,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklist_reason" TEXT,
    "custom_data" JSONB,
    "archived_at" TIMESTAMP(3),
    "import_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- (tenant_id, id) unique keys, created before the foreign keys below that
-- target them as a composite — Postgres requires the referenced columns to
-- already have a unique constraint.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "clients_tenant_id_id_key" ON "clients"("tenant_id", "id");
CREATE UNIQUE INDEX "students_tenant_id_id_key" ON "students"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_phones" ADD CONSTRAINT "client_phones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_phones" ADD CONSTRAINT "client_phones_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_tenant_id_student_id_fkey" FOREIGN KEY ("tenant_id", "student_id") REFERENCES "students"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- full_name_key: the TZ 8.5 comparison/sort key for clients, same function
-- as every other name_key column (see the T05 migration for uz_search_key's
-- definition — it already exists in this database).
-- ---------------------------------------------------------------------------
ALTER TABLE "clients" ADD COLUMN "full_name_key" TEXT GENERATED ALWAYS AS (uz_search_key("full_name")) STORED;

CREATE INDEX "clients_tenant_id_full_name_key_idx" ON "clients" ("tenant_id", "full_name_key");

-- gin_trgm_ops partial-match search (TZ 5.2 "CREATE INDEX ON clients USING
-- gin (full_name gin_trgm_ops)"). pg_trgm ships with Postgres but is not
-- enabled by default.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "clients_full_name_trgm_idx" ON "clients" USING gin ("full_name" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Remaining indexes
-- ---------------------------------------------------------------------------
CREATE INDEX "client_phones_tenant_id_phone_e164_idx" ON "client_phones"("tenant_id", "phone_e164");
CREATE INDEX "client_phones_tenant_id_client_id_idx" ON "client_phones"("tenant_id", "client_id");

-- TZ M3.2 BR-S1: a client has exactly one student card.
CREATE UNIQUE INDEX "students_tenant_id_client_id_key" ON "students"("tenant_id", "client_id");
CREATE INDEX "students_tenant_id_branch_id_status_idx" ON "students"("tenant_id", "branch_id", "status");

-- TZ 5.2: the two watch-list shapes a dashboard/report scans for.
CREATE INDEX "students_tenant_id_balance_idx" ON "students" ("tenant_id", "cached_balance") WHERE "cached_balance" < 0;
CREATE INDEX "students_tenant_id_churn_idx" ON "students" ("tenant_id", "churn_score" DESC) WHERE "churn_score" >= 50;

CREATE INDEX "contact_persons_tenant_id_student_id_idx" ON "contact_persons"("tenant_id", "student_id");

CREATE INDEX "import_batches_tenant_id_created_at_idx" ON "import_batches"("tenant_id", "created_at" DESC);

-- Exactly one primary phone per client — Postgres treats every row with
-- is_primary = false as distinct for a plain unique index, so this has to
-- be partial.
CREATE UNIQUE INDEX "client_phones_one_primary_per_client"
    ON "client_phones" ("client_id") WHERE "is_primary";

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "students"
  ADD CONSTRAINT "students_churn_score_range" CHECK ("churn_score" IS NULL OR ("churn_score" BETWEEN 0 AND 100));

ALTER TABLE "students"
  ADD CONSTRAINT "students_archived_at_matches_status"
  CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Row-Level Security — the standard pattern (CLAUDE.md "Non-negotiable"),
-- covered per table by test/integration/rls.spec.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "clients"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "client_phones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_phones" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "client_phones"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "contact_persons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_persons" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "contact_persons"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "students" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "students"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "import_batches"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
