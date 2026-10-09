-- ---------------------------------------------------------------------------
-- audit_log partition maintenance, callable by the worker process
--
-- `ensure_audit_log_partition` shipped with the audit_log migration as the
-- maintenance entry point, but nothing could call it on a schedule: it is
-- DDL (CREATE TABLE PARTITION OF), and the running application connects as
-- `app_user`, which has no CREATE privilege on the schema and does not own
-- `audit_log`. The 36-month runway pre-created there ends 2029-10, and an
-- INSERT into an uncovered month fails loudly on purpose, so something has
-- to extend it (docs/QUESTIONS.md, now closed by a product-owner decision:
-- a monthly worker job keeps >= 3 months of future partitions).
--
-- Two options were on the table. Handing the worker process the `migrator`
-- credentials would give a long-running network-facing process unrestricted
-- DDL over the whole schema. Instead the function becomes SECURITY DEFINER
-- with EXECUTE granted to `app_user` alone: the privilege app_user gains is
-- exactly "create the audit_log partition for month X", nothing wider. The
-- function takes no identifier from the caller — the partition name is
-- derived from the DATE argument via to_char, so there is no injection
-- surface, and `format('%I')` quotes it regardless.
--
-- `SET search_path = public, pg_temp` is mandatory for any SECURITY DEFINER
-- function: without it a caller could prepend a schema of their own and
-- have the definer-privileged body resolve `audit_log` (or a function it
-- calls) to an object they control.
--
-- This is the second SECURITY DEFINER function in the schema, after
-- `auth_find_user`. Unlike that one it reads no rows at all, so it is not
-- an RLS bypass: every partition it creates re-applies the standard
-- tenant_isolation policy with FORCE, as before.
--
-- Also added here: concurrency safety. Two worker replicas (or a worker and
-- a manual call) can reach the same month at the same moment, and the
-- EXISTS check alone is not enough — both would pass it and the loser's
-- CREATE TABLE would raise duplicate_table. A transaction-scoped advisory
-- lock serializes same-month callers, and the duplicate_table handler makes
-- the "lost the race anyway" path a no-op rather than a failed job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_audit_log_partition(p_month DATE) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Serializes concurrent callers for this month only; released at commit.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_audit_log_partition'), hashtext(v_name));

  -- Re-check: the lock holder before us may have just created it.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = v_name AND n.nspname = 'public'
  ) THEN
    RETURN v_name;
  END IF;

  BEGIN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "audit_log" FOR VALUES FROM (%L) TO (%L)',
      v_name, v_from, v_to
    );
  EXCEPTION
    -- Belt and braces: an advisory lock only covers callers that take it.
    WHEN duplicate_table THEN
      RETURN v_name;
  END;

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_name);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I'
    ' USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)'
    ' WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
    v_name
  );
  -- New partitions are created by the definer (migrator), so they pick up
  -- app_user's default DML grants — strip the two the append-only trigger
  -- would reject anyway, exactly as the parent table does.
  EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_user', v_name);

  RETURN v_name;
END;
$$;

-- A SECURITY DEFINER function is EXECUTE-able by PUBLIC by default. Narrow
-- it to the one role that needs it before granting.
REVOKE ALL ON FUNCTION ensure_audit_log_partition(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_audit_log_partition(DATE) TO app_user;
