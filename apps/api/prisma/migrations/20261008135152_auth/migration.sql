-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('own', 'branch', 'all');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_phone_key" ON "users"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_family_id_idx" ON "sessions"("tenant_id", "family_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_user_id_idx" ON "sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tenant_id_token_hash_key" ON "sessions"("tenant_id", "token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_tenant_id_role_id_permission_code_key" ON "role_permissions"("tenant_id", "role_id", "permission_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_tenant_id_user_id_role_id_key" ON "user_roles"("tenant_id", "user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_tenant_id_user_id_branch_id_key" ON "user_branches"("tenant_id", "user_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Every table migrator creates gets SELECT/INSERT/UPDATE/DELETE for app_user
-- automatically via the ALTER DEFAULT PRIVILEGES in docker/postgres/init.sql.
-- `permissions` is the exception, same reasoning as `tenants`: it's a global
-- catalog, not something the running API writes to.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON "permissions" FROM app_user;
GRANT SELECT ON "permissions" TO app_user;

-- ---------------------------------------------------------------------------
-- Row-Level Security — standard pattern (CLAUDE.md "Non-negotiable"), copied
-- verbatim per table: ENABLE + FORCE + USING/WITH CHECK with the NULLIF
-- guard against the PgBouncer-pooled "reset to '' instead of NULL" case.
--
-- `users` is the ONE documented exception: ENABLE but deliberately NOT
-- FORCE. Without FORCE, Postgres exempts the table OWNER (migrator) from
-- the policy — that's what lets `auth_find_user` below (a SECURITY DEFINER
-- function owned by migrator) search across all tenants by
-- (tenant_slug, login) during login, before any `app.current_tenant` can
-- possibly be set. `app_user` is never the table owner, so every direct
-- query the running API makes against `users` is still fully tenant-scoped
-- — this exception only widens what the owner can do, not what app_user can
-- do. This is the only RLS bypass anywhere in the schema.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "sessions"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "roles"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "role_permissions"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "user_roles"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "user_branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_branches" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "user_branches"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- auth_find_user — the one documented RLS bypass.
--
-- Looks a user up by (tenant_slug, login) before any tenant context can
-- exist (login is the entry point — the client doesn't have a tenant_id
-- yet, only a human-chosen slug). SECURITY DEFINER makes it run as its
-- owner (migrator); migrator owns `users` and `users` has no FORCE, so the
-- lookup itself is exempt from RLS. The function's own WHERE clause does
-- the real scoping explicitly (by slug, via a join to `tenants`) — it does
-- not rely on `app.current_tenant` at all, so it works correctly regardless
-- of session state. It returns ONLY the four columns login needs, never a
-- full user row, and ONLY app_user may call it (no other SELECT/UPDATE
-- access to `users` is granted beyond the normal tenant-scoped grants).
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_find_user(p_tenant_slug TEXT, p_login TEXT)
RETURNS TABLE (user_id UUID, tenant_id UUID, password_hash TEXT, is_active BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.is_active
  FROM "users" u
  JOIN "tenants" t ON t.id = u.tenant_id
  WHERE t.slug = p_tenant_slug
    AND (u.phone = p_login OR u.email = p_login)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_find_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(TEXT, TEXT) TO app_user;

-- ---------------------------------------------------------------------------
-- Deactivating a user revokes all of their sessions — enforced at the
-- database level (not just in application code) so it holds regardless of
-- which code path flips is_active.
-- ---------------------------------------------------------------------------
CREATE FUNCTION revoke_sessions_on_deactivate() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    UPDATE "sessions"
    SET revoked_at = now()
    WHERE user_id = NEW.id
      AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_revoke_sessions_on_deactivate
AFTER UPDATE ON "users"
FOR EACH ROW
EXECUTE FUNCTION revoke_sessions_on_deactivate();

-- ---------------------------------------------------------------------------
-- Permission catalog (TZ 3.2) — global, seeded once. Role -> permission
-- assignments are per-tenant (role_permissions.tenant_id) and are cloned
-- from the in-code role templates when a tenant is provisioned (see
-- apps/api/src/auth/role-templates.ts and the seed:owner CLI), not seeded
-- here.
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" (code, description) VALUES
  ('branch.view', 'view branch'),
  ('branch.create', 'create branch'),
  ('branch.update', 'update branch'),
  ('branch.archive', 'archive branch'),
  ('classroom.manage', 'manage classroom'),
  ('employee.view', 'view employee'),
  ('employee.create', 'create employee'),
  ('employee.update', 'update employee'),
  ('employee.deactivate', 'deactivate employee'),
  ('role.manage', 'manage role'),
  ('teacher.view_salary_settings', 'view salary settings teacher'),
  ('teacher.edit_salary_settings', 'edit salary settings teacher'),
  ('inbound.view', 'view inbound'),
  ('inbound.process', 'process inbound'),
  ('inbound.archive', 'archive inbound'),
  ('inbound.purge', 'purge inbound'),
  ('lead.view', 'view lead'),
  ('lead.create', 'create lead'),
  ('lead.update', 'update lead'),
  ('lead.delete', 'delete lead'),
  ('lead.view_contacts', 'view contacts lead'),
  ('lead.bulk_action', 'bulk action lead'),
  ('lead.change_owner', 'change owner lead'),
  ('student.view', 'view student'),
  ('student.create', 'create student'),
  ('student.update', 'update student'),
  ('student.archive', 'archive student'),
  ('student.merge', 'merge student'),
  ('student.view_contacts', 'view contacts student'),
  ('student.view_passport', 'view passport student'),
  ('student.export_personal_data', 'export personal data student'),
  ('study_unit.view', 'view study unit'),
  ('study_unit.create', 'create study unit'),
  ('study_unit.update', 'update study unit'),
  ('study_unit.delete', 'delete study unit'),
  ('study_unit.change_status', 'change status study unit'),
  ('study_unit.manage_members', 'manage members study unit'),
  ('waitlist.manage', 'manage waitlist'),
  ('enrollment.freeze', 'freeze enrollment'),
  ('schedule.view', 'view schedule'),
  ('schedule.create', 'create schedule'),
  ('schedule.update', 'update schedule'),
  ('schedule.delete', 'delete schedule'),
  ('lesson.cancel', 'cancel lesson'),
  ('lesson.reschedule', 'reschedule lesson'),
  ('lesson.substitute_teacher', 'substitute teacher lesson'),
  ('lesson.complete', 'complete lesson'),
  ('attendance.view', 'view attendance'),
  ('attendance.mark', 'mark attendance'),
  ('attendance.mark_past', 'mark past attendance'),
  ('attendance.edit_locked', 'edit locked attendance'),
  ('price.view', 'view price'),
  ('price.manage', 'manage price'),
  ('discount.manage', 'manage discount'),
  ('finance.view_amounts', 'View monetary amounts in finance screens (kept separate from report.finance)'),
  ('invoice.view', 'view invoice'),
  ('invoice.create', 'create invoice'),
  ('invoice.update', 'update invoice'),
  ('invoice.cancel', 'cancel invoice'),
  ('payment.view', 'view payment'),
  ('payment.create', 'create payment'),
  ('payment.update', 'update payment'),
  ('payment.delete', 'delete payment'),
  ('payment.refund', 'refund payment'),
  ('installment.manage', 'manage installment'),
  ('ledger.view', 'view ledger'),
  ('ledger.adjust', 'adjust ledger'),
  ('ledger.transfer', 'transfer ledger'),
  ('payroll.view_own', 'view own payroll'),
  ('payroll.view_all', 'view all payroll'),
  ('payroll.calculate', 'calculate payroll'),
  ('payroll.approve', 'approve payroll'),
  ('payroll.pay', 'pay payroll'),
  ('payroll.reopen', 'reopen payroll'),
  ('report.finance', 'finance report'),
  ('report.sales', 'sales report'),
  ('report.load', 'load report'),
  ('report.profitability', 'profitability report'),
  ('report.manager', 'manager report'),
  ('report.retention', 'retention report'),
  ('message.send', 'send message'),
  ('message.bulk_send', 'bulk send message'),
  ('template.manage', 'manage template'),
  ('automation.manage', 'manage automation'),
  ('chat.view_all', 'view all chat'),
  ('chat.reply', 'reply chat'),
  ('import.run', 'run import'),
  ('import.rollback', 'rollback import'),
  ('export.run', 'run export'),
  ('audit.view', 'view audit'),
  ('settings.manage', 'manage settings'),
  ('api_key.manage', 'manage api key');
