-- ---------------------------------------------------------------------------
-- outbox_events (TZ 7.3 pattern 1, TZ M2 "SHART — ishonchlilik", TZ 5.1)
--
-- The transactional outbox. A business change and its side effects (SMS,
-- Telegram, payroll recalculation) must not share a transaction — TZ M2 is
-- explicit that calling a provider from inside a service method is the most
-- common mistake in this domain: a slow provider holds the transaction (and
-- its locks) open. Instead the event is written here *in* the business
-- transaction, and a worker picks it up afterwards.
--
-- causation_id / causation_depth exist for TZ M2's cycle protection: an
-- event produced by an automation inherits its parent's depth + 1, and the
-- chain is cut past depth 3 (A changes status -> B reverts it -> forever).
-- ---------------------------------------------------------------------------
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'dispatched', 'done', 'dead');

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "causation_id" UUID,
    "causation_depth" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- TZ M2: "chuqurlik > 3 bo'lsa zanjir to'xtatiladi". Enforced in
-- OutboxService.publish as well, with a real error message; this is the
-- backstop that holds even for a direct SQL insert.
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_causation_depth_check" CHECK ("causation_depth" BETWEEN 0 AND 3);

-- Verbatim from TZ 5.2. Partial indexes can't be expressed in
-- schema.prisma, so this one lives only here — like the triggers, policies
-- and functions in the other migrations.
CREATE INDEX "outbox_events_next_retry_at_pending_idx"
    ON "outbox_events" ("next_retry_at")
    WHERE "status" = 'pending';

-- Recovering claims whose dispatch died between UPDATE and enqueue.
CREATE INDEX "outbox_events_dispatched_at_idx"
    ON "outbox_events" ("dispatched_at")
    WHERE "status" = 'dispatched';

CREATE INDEX "outbox_events_tenant_id_created_at_idx"
    ON "outbox_events" ("tenant_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security — standard pattern (CLAUDE.md "Non-negotiable"),
-- copied verbatim, FORCE included.
--
-- Note what this means for the worker: it cannot "SELECT ... FROM
-- outbox_events" across tenants, and it is not supposed to be able to.
-- Instead OutboxDispatcher enumerates `tenants` (no tenant_id, no RLS) and
-- claims a batch inside each tenant's own context, so the pending work is
-- found without a BYPASSRLS role or a second SECURITY DEFINER escape hatch.
-- See apps/api/src/outbox/outbox-dispatcher.service.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "outbox_events"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
