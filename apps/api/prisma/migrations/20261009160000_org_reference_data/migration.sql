-- ---------------------------------------------------------------------------
-- T05 — organization and reference data (TZ M1.1–M1.4)
--
-- Tables: classrooms, disciplines, levels, age_categories, payment_methods,
-- holidays, teacher_profiles, teacher_disciplines, teacher_levels. Plus
-- `updated_at` on branches and users, which until now had no update path.
--
-- Three things in here are not Prisma-expressible and are the reason this
-- file is hand-finished rather than purely generated:
--
--  1. `uz_search_key(text)` and the unique indexes built on it. Name
--     uniqueness has to be per tenant *and* apostrophe/case/whitespace
--     insensitive (TZ 8.5): "Ingliz tili", "ingliz  tili" and "Ingliz tili"
--     typed with an ASCII apostrophe are one discipline, not three. The
--     function mirrors `uzSearchKey` in packages/shared/src/uz-text.ts —
--     test/integration/uz-search-key.spec.ts proves the two agree, because
--     a client that searches by a different key than the database indexes
--     is a silently broken search.
--
--  2. Partial unique indexes for the nullable-parent cases (a holiday with
--     no branch, a level with no discipline). Postgres treats NULLs as
--     distinct, so a plain unique index would happily take the same
--     organization-wide holiday twice.
--
--  3. CHECK constraints: capacity > 0, an age band that isn't inverted.
--
-- Cross-tenant references are structurally impossible here, not merely
-- policy-blocked: every reference to another tenant-scoped row is a
-- composite `(tenant_id, x_id)` foreign key, so a row can only ever point
-- at its own tenant's data even if a service forgets to check. That is why
-- branches, users, disciplines, levels and teacher_profiles grow a
-- `UNIQUE (tenant_id, id)` — it is the key those FKs point at.
-- `teacher_disciplines` / `teacher_levels` carry no FK to `tenants`
-- directly; their composite FK to teacher_profiles already guarantees the
-- tenant exists.
--
-- Nothing here is ever deleted (TZ M1.1 "Filial o'chirilmaydi —
-- is_active=false", TZ M1.3 KERAK "Har bir ma'lumotnoma yozuvi
-- o'chirilmaydi, is_active=false qilinadi"): lessons, charges and payments
-- reference these rows, and every FK above is ON DELETE RESTRICT so the
-- database refuses a delete that would cut a historical link.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "equipment" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disciplines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "discipline_id" UUID,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "age_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_age" INTEGER NOT NULL,
    "max_age" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "age_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_disciplines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "discipline_id" UUID NOT NULL,

    CONSTRAINT "teacher_disciplines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,

    CONSTRAINT "teacher_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classrooms_tenant_id_branch_id_idx" ON "classrooms"("tenant_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "disciplines_tenant_id_id_key" ON "disciplines"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "levels_tenant_id_discipline_id_idx" ON "levels"("tenant_id", "discipline_id");

-- CreateIndex
CREATE UNIQUE INDEX "levels_tenant_id_id_key" ON "levels"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_tenant_id_user_id_key" ON "teacher_profiles"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_tenant_id_id_key" ON "teacher_profiles"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "teacher_disciplines_tenant_id_discipline_id_idx" ON "teacher_disciplines"("tenant_id", "discipline_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_disciplines_tenant_id_teacher_profile_id_discipline_key" ON "teacher_disciplines"("tenant_id", "teacher_profile_id", "discipline_id");

-- CreateIndex
CREATE INDEX "teacher_levels_tenant_id_level_id_idx" ON "teacher_levels"("tenant_id", "level_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_levels_tenant_id_teacher_profile_id_level_id_key" ON "teacher_levels"("tenant_id", "teacher_profile_id", "level_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplines" ADD CONSTRAINT "disciplines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_tenant_id_discipline_id_fkey" FOREIGN KEY ("tenant_id", "discipline_id") REFERENCES "disciplines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "age_categories" ADD CONSTRAINT "age_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_disciplines" ADD CONSTRAINT "teacher_disciplines_tenant_id_teacher_profile_id_fkey" FOREIGN KEY ("tenant_id", "teacher_profile_id") REFERENCES "teacher_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_disciplines" ADD CONSTRAINT "teacher_disciplines_tenant_id_discipline_id_fkey" FOREIGN KEY ("tenant_id", "discipline_id") REFERENCES "disciplines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_levels" ADD CONSTRAINT "teacher_levels_tenant_id_teacher_profile_id_fkey" FOREIGN KEY ("tenant_id", "teacher_profile_id") REFERENCES "teacher_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_levels" ADD CONSTRAINT "teacher_levels_tenant_id_level_id_fkey" FOREIGN KEY ("tenant_id", "level_id") REFERENCES "levels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- uz_search_key(text) — the TZ 8.5 comparison key, in SQL
--
-- Mirrors `uzSearchKey` in packages/shared/src/uz-text.ts: lower-case, every
-- apostrophe variant (ASCII, curly, U+02BB oʻ/gʻ, U+02BC tutuq belgisi,
-- backtick, acute, prime) removed rather than folded, whitespace collapsed
-- and trimmed. Dropping the mark is what lets a user who types "oquvchi"
-- find "Oʻquvchi" and keeps "Gʻafurov" sorting next to "Fozilov" instead of
-- after every ASCII name.
--
-- One deliberate divergence: the TypeScript version also strips NFD
-- combining marks (so "José" keys as "jose"), which would need the
-- `unaccent` extension here. Uzbek Latin has no such diacritics, so the
-- only affected input is a pasted foreign name; it would be indexed under
-- its accented form. Noted in docs/QUESTIONS.md rather than silently.
--
-- IMMUTABLE (and it genuinely is — no locale-dependent collation, `lower`
-- on these inputs is stable) because expression indexes require it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION uz_search_key(p_value TEXT) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(
    regexp_replace(
      lower(translate(p_value, E'\'‘’ʻʼ`´′‵', '')),
      '\s+', ' ', 'g'
    )
  );
$$;

COMMENT ON FUNCTION uz_search_key(TEXT) IS
  'TZ 8.5 apostrophe/case/whitespace-insensitive comparison key. Mirrors uzSearchKey() in packages/shared.';

-- ---------------------------------------------------------------------------
-- name_key: the normalized key as a stored generated column
--
-- Stored rather than computed per query so the application can filter,
-- sort and enforce uniqueness on it with ordinary SQL — `ORDER BY name_key`
-- is the TZ 8.5 collation the raw `name` column cannot give (a code-point
-- sort puts every "Gʻafurov" after every ASCII name), and Postgres keeps it
-- in step with `name` on every write, so there is no way for application
-- code to forget.
--
-- Deliberately nullable: `name` is NOT NULL and uz_search_key is STRICT, so
-- the value is never actually null, and leaving the column nullable is what
-- lets the Prisma model carry it as an optional read-only field without
-- claiming it can write it.
-- ---------------------------------------------------------------------------
ALTER TABLE "classrooms"      ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "disciplines"     ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "levels"          ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "age_categories"  ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "payment_methods" ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "holidays"        ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "branches"        ADD COLUMN "name_key" TEXT GENERATED ALWAYS AS (uz_search_key("name")) STORED;
ALTER TABLE "users"           ADD COLUMN "full_name_key" TEXT GENERATED ALWAYS AS (uz_search_key("full_name")) STORED;

-- ---------------------------------------------------------------------------
-- Optimistic locking (TZ 6.1 SHART: "PATCH so'rovlari If-Match: <version>
-- qabul qiladi; mos kelmasa 409 VERSION_CONFLICT", UX §3.8 "Versiya
-- konflikti")
--
-- An integer the service bumps inside the same UPDATE it filters on
-- (`WHERE id = $1 AND version = $2`), so a lost update is impossible rather
-- than unlikely. `updated_at` was the obvious alternative and is the wrong
-- one: two edits inside the same millisecond would compare equal, and the
-- value is a timestamp a client could legitimately send back rounded.
-- ---------------------------------------------------------------------------
ALTER TABLE "classrooms"       ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "disciplines"      ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "levels"           ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "age_categories"   ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "payment_methods"  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "holidays"         ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "teacher_profiles" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "branches"         ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users"            ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Name uniqueness, on the normalized key
--
-- Scoped to what the name actually identifies: a classroom name is unique
-- within its branch (every branch has a "204"), a level within its
-- discipline, everything else within the tenant. Archived rows are included
-- on purpose — reusing the name of an archived discipline would make the
-- audit trail and old reports ambiguous; un-archive it instead.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "classrooms_tenant_branch_name_key"
    ON "classrooms" ("tenant_id", "branch_id", "name_key");

CREATE UNIQUE INDEX "disciplines_tenant_name_key"
    ON "disciplines" ("tenant_id", "name_key");

CREATE UNIQUE INDEX "age_categories_tenant_name_key"
    ON "age_categories" ("tenant_id", "name_key");

CREATE UNIQUE INDEX "payment_methods_tenant_name_key"
    ON "payment_methods" ("tenant_id", "name_key");

-- Levels: one index per nullability case. `WHERE discipline_id IS NULL`
-- is what stops a second organization-wide "A1" being accepted because
-- Postgres considers two NULLs distinct.
CREATE UNIQUE INDEX "levels_tenant_discipline_name_key"
    ON "levels" ("tenant_id", "discipline_id", "name_key")
 WHERE "discipline_id" IS NOT NULL;

CREATE UNIQUE INDEX "levels_tenant_global_name_key"
    ON "levels" ("tenant_id", "name_key")
 WHERE "discipline_id" IS NULL;

-- Holidays: one date per branch, and one organization-wide entry per date.
-- A branch-specific closure on a date that is already an org-wide holiday
-- is allowed (and harmless — the day is skipped either way).
CREATE UNIQUE INDEX "holidays_tenant_branch_date_key"
    ON "holidays" ("tenant_id", "branch_id", "date")
 WHERE "branch_id" IS NOT NULL;

CREATE UNIQUE INDEX "holidays_tenant_global_date_key"
    ON "holidays" ("tenant_id", "date")
 WHERE "branch_id" IS NULL;

-- Sort/search support for the P1 list screens: every one of them orders by
-- name_key and filters it with ILIKE.
CREATE INDEX "levels_tenant_name_key_idx"          ON "levels" ("tenant_id", "name_key");
CREATE INDEX "holidays_tenant_name_key_idx"        ON "holidays" ("tenant_id", "name_key");
CREATE INDEX "branches_tenant_name_key_idx"        ON "branches" ("tenant_id", "name_key");
CREATE INDEX "users_tenant_full_name_key_idx"      ON "users" ("tenant_id", "full_name_key");

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "classrooms"
  ADD CONSTRAINT "classrooms_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0);

-- An inverted band ("12 dan 7 gacha") can only be a data-entry mistake, and
-- it would silently match no student at all.
ALTER TABLE "age_categories"
  ADD CONSTRAINT "age_categories_band_valid"
  CHECK ("min_age" >= 0 AND "min_age" <= 120 AND ("max_age" IS NULL OR "max_age" >= "min_age"));

-- ---------------------------------------------------------------------------
-- Row-Level Security — the standard pattern (CLAUDE.md "Non-negotiable"),
-- copied verbatim for every new tenant-scoped table. FORCE is required or
-- the policy is skipped for the table owner (migrator); NULLIF(..., '')
-- is required because a PgBouncer-pooled connection resets the GUC to the
-- empty string, and ''::uuid throws instead of excluding rows.
--
-- Covered per table by test/integration/rls.spec.ts (cross-tenant SELECT
-- and cross-tenant INSERT both denied).
-- ---------------------------------------------------------------------------
ALTER TABLE "classrooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "classrooms" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "classrooms"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "disciplines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disciplines" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "disciplines"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "levels" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "levels"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "age_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "age_categories" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "age_categories"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "payment_methods"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "holidays"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "teacher_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "teacher_profiles"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "teacher_disciplines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_disciplines" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "teacher_disciplines"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "teacher_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_levels" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "teacher_levels"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Reference data permission (TZ 3.2 catalog addition)
--
-- The catalog has `settings.manage` for changing reference data but nothing
-- for *reading* it, and every operational screen needs to read it: an
-- administrator picking a discipline for a group holds no settings
-- permission and must not. Rather than let these endpoints run without a
-- permission (CLAUDE.md: every endpoint gets @RequirePermission or
-- @Public), `reference.view` is added to the catalog and granted to every
-- role template. Writes stay behind `settings.manage`. See
-- docs/QUESTIONS.md.
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("code", "description") VALUES
  ('reference.view', 'Read reference data: disciplines, levels, age categories, payment methods, holidays, classrooms')
ON CONFLICT ("code") DO NOTHING;

-- Backfill: roles created from the templates before this migration have no
-- `reference.view` row, and the templates are only applied when a tenant is
-- seeded. Granted at `all` scope to every existing role because reference
-- data has no branch dimension and carries nothing sensitive — a name and a
-- sort order. Writes are still `settings.manage`, which is unchanged.
--
-- The per-tenant loop is not optional: `roles` carries FORCE row level
-- security, so a plain `INSERT ... SELECT FROM roles` run by the migration
-- (migrator, no `app.current_tenant` in the session) silently matches zero
-- rows — and `SET row_security = off` does not help, it errors out by
-- design. `tenants` is the one table with no RLS, so it can drive the loop.
-- Any future data migration over a tenant-scoped table needs this shape.
DO $$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant', v_tenant."id"::text, true);
    INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_code", "scope")
    SELECT gen_random_uuid(), r."tenant_id", r."id", 'reference.view', 'all'
      FROM "roles" r
     WHERE r."tenant_id" = v_tenant."id"
     ON CONFLICT ("tenant_id", "role_id", "permission_code") DO NOTHING;
  END LOOP;
  PERFORM set_config('app.current_tenant', '', true);
END;
$$;
