-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Grants
--
-- app_user gets SELECT/INSERT/UPDATE/DELETE on every table automatically via
-- the ALTER DEFAULT PRIVILEGES set up for the `migrator` role in
-- docker/postgres/init.sql. `tenants` is the deliberate exception: tenant
-- provisioning is not exposed through the API yet, so app_user may only
-- read it.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON "tenants" FROM app_user;
GRANT SELECT ON "tenants" TO app_user;

-- ---------------------------------------------------------------------------
-- Row-Level Security — reusable pattern for every tenant-scoped table.
--
-- FORCE is required so the policy also applies to the table owner
-- (migrator); without it, RLS is silently bypassed for the owner role.
-- WITH CHECK is required so INSERT/UPDATE cannot write rows for a different
-- tenant than the one in the session's `app.current_tenant` setting.
-- `current_setting(..., true)` (missing_ok = true) returns NULL instead of
-- erroring when unset, so a request with no tenant context sees zero rows
-- rather than failing with a Postgres error. BUT: once a connection has had
-- this placeholder GUC set at least once (e.g. a prior transaction on a
-- PgBouncer-pooled backend connection), it resets to '' (empty string), not
-- NULL, after that transaction ends — and ''::uuid throws instead of
-- comparing false. NULLIF(..., '') normalizes both "never set" and
-- "reset after a prior transaction" to the same safe NULL, so this stays a
-- clean zero-rows deny in both cases instead of an error in the second one.
-- ---------------------------------------------------------------------------
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "branches"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
