-- ---------------------------------------------------------------------------
-- audit_log (TZ M11.3)
--
-- Format is taken verbatim from the spec: actor_id, action, entity_type,
-- entity_id, diff JSONB, ip, user_agent, request_id, occurred_at. Plus the
-- tenant_id every tenant-scoped table carries.
--
-- Three properties the spec calls SHART (mandatory), each enforced below:
--   append-only  — trigger + REVOKE, same approach M6.4 prescribes for
--                  ledger_entries
--   ≥ 3 years retention
--   monthly partitioning
--
-- Column type notes:
--   entity_id is TEXT, not UUID. Most audited entities have a UUID primary
--   key, but not all of them do — `permissions.code` is a TEXT primary key
--   today, and role/permission changes are explicitly on the list of things
--   that must be audited. A log that cannot record the identifier of the
--   thing it is logging is worse than a slightly loose column type.
--   ip is TEXT, not INET: it's copied straight from `req.ip`, which may be
--   a comma-joined X-Forwarded-For chain rather than a single address, and
--   a cast failure must never be able to abort an audited operation.
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- occurred_at has to be part of the primary key: Postgres requires the
    -- partition key to be included in every unique constraint on a
    -- partitioned table.
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- "who did what to this record" — the object-card history timeline (UX P2).
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_idx"
    ON "audit_log" ("tenant_id", "entity_type", "entity_id");

-- "what happened recently" — the audit.view screen.
CREATE INDEX "audit_log_tenant_id_occurred_at_idx"
    ON "audit_log" ("tenant_id", "occurred_at" DESC);

CREATE INDEX "audit_log_tenant_id_actor_id_occurred_at_idx"
    ON "audit_log" ("tenant_id", "actor_id", "occurred_at" DESC);

-- ---------------------------------------------------------------------------
-- Append-only (TZ M11.3, "append-only (trigger, M6.4 kabi)")
--
-- The trigger is the real guarantee: it is defined on the partitioned
-- parent, so Postgres propagates it to every current and future partition,
-- and it fires for *every* role including the table owner. The REVOKE below
-- is defence in depth for app_user specifically — belt and braces, because
-- a tampered audit trail is indistinguishable from no audit trail.
--
-- TRUNCATE needs no trigger: `ALTER DEFAULT PRIVILEGES` in
-- docker/postgres/init.sql grants app_user only SELECT/INSERT/UPDATE/DELETE,
-- and TRUNCATE is owner-only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_log_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (TZ M11.3): % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW
EXECUTE FUNCTION audit_log_append_only();

REVOKE UPDATE, DELETE ON "audit_log" FROM app_user;

-- ---------------------------------------------------------------------------
-- Row-Level Security — standard pattern (CLAUDE.md "Non-negotiable"),
-- copied verbatim.
--
-- Applied to the partitioned parent, which is the only way the application
-- ever reads or writes this table. `ensure_audit_log_partition` below
-- repeats the same three statements on each partition, so a direct query
-- against a partition is denied too.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "audit_log"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Monthly partitions
--
-- There is deliberately NO default partition. A default partition would
-- make a missing month silently succeed, but it also makes creating that
-- month's partition later require moving rows *out* of the default — a
-- DELETE, which the append-only trigger above (correctly) refuses. Rather
-- than punch a hole in the append-only guarantee for the sake of
-- partition maintenance, partitions are pre-created with a long runway and
-- an INSERT for an uncovered month fails loudly.
--
-- `ensure_audit_log_partition` is the maintenance entry point: idempotent,
-- so it is safe to call repeatedly, and it re-applies the RLS pattern and
-- the REVOKE to the new partition (new partitions are created by migrator,
-- so they otherwise pick up app_user's default DML grants).
-- ---------------------------------------------------------------------------
CREATE FUNCTION ensure_audit_log_partition(p_month DATE) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
  v_name TEXT := 'audit_log_' || to_char(v_from, 'YYYY_MM');
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = v_name AND n.nspname = 'public'
  ) THEN
    RETURN v_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF "audit_log" FOR VALUES FROM (%L) TO (%L)',
    v_name, v_from, v_to
  );

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_name);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I'
    ' USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)'
    ' WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
    v_name
  );
  EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_user', v_name);

  RETURN v_name;
END;
$$;

-- 36 months of runway from the month this migration ships. Partition
-- maintenance past that is an open item (docs/QUESTIONS.md) — the function
-- above is what a scheduled job will call.
DO $$
DECLARE
  v_month DATE := DATE '2026-10-01';
BEGIN
  WHILE v_month < DATE '2029-10-01' LOOP
    PERFORM ensure_audit_log_partition(v_month);
    v_month := (v_month + INTERVAL '1 month')::date;
  END LOOP;
END;
$$;
