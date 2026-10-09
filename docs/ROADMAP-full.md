# EduCRM — Roadmap (task queue)

Derived from TZ v2.0 §12 (phases), §4 (M1–M12) and §13.2 (R1 acceptance).
This file is the task queue referenced by `CLAUDE.md`.

**How to use it:** take the **first unchecked task**, do ONLY that task
(backend + frontend + tests), check it off, append 3 lines to
`docs/PROGRESS.md`. One task = one vertical slice = one commit.

Release model (TZ §1.3): **R1 Core MVP** → **R2 Growth** → **R3 Scale**.
R2 does not start before R1 runs for real in the pilot branch.

Each task names the TZ sections to read before implementing it.

---

## Phase 0 — Poydevor (R1)

- [x] **0.1 Monorepo skeleton** — pnpm workspaces + Turborepo, `apps/api`
      (NestJS 11), `apps/web` (Next 15), `packages/shared`,
      `packages/config`, Docker Compose (Postgres 5433 / PgBouncer 6433 /
      Redis 6380), health endpoints. — TZ §7
- [x] **0.2 Multi-tenant data layer** — `tenants`, `branches`, Prisma +
      `migrator`/`app_user` DB roles, `TENANT_PRISMA` provider,
      `tenantDb.transaction`, the ENABLE+FORCE RLS policy pattern, RLS and
      PgBouncer integration tests. — TZ §5.3
- [x] **0.3 Authentication + RBAC** — users/sessions/roles/role_permissions/
      user_roles/user_branches, TZ 3.2 permission catalog + 6 system role
      templates, `auth_find_user` SECURITY DEFINER lookup, Argon2id, 15min
      access JWT + 30day rotating refresh with family reuse detection,
      httpOnly cookies + CSRF double-submit, global default-deny permission
      guard, Redis rate limit + lockout, `seed:owner` CLI, web login +
      protected layout. — TZ §3, §6.1, §6.5, §8.3 · `docs/tasks/step-0.3.md`
- [ ] **0.4 Money value object** — `Money` in `packages/shared`: BIGINT
      tiyin as TypeScript `bigint`, `currency` (ISO 4217, default UZS),
      add/sub/mul/percent, pro-rata split where the remainder lands on the
      **last** item, formatting for display only. An ESLint rule that
      forbids `number` arithmetic on money-typed values. Property-based
      tests (split sums are always exact). No money logic anywhere until
      this exists. — TZ §6.1 (M6.1), §13.1
- [ ] **0.5 Observability + CI/CD** — structured JSON logging with
      `request_id`, the TZ 6.2 error format end-to-end, Prometheus metrics
      (API RPS/latency/error %, DB pool, queue depth), `/health/live` +
      `/health/ready` for zero-downtime rolling updates, graceful shutdown
      (SIGTERM → drain ≤30s), alert rules, GitHub Actions running
      lint/typecheck/test/migrate on every PR. — TZ §11.2, §11.3, §11.4
- [ ] **0.6 Staff 2FA (TOTP)** — deliberately deferred out of 0.3. TOTP
      enrolment + recovery codes for roles that can see money; required
      before R1 ships, not before phase 1 starts. — TZ §3.3, §8.3

## Phase 1 — Akademik yadro (R1)

- [ ] **1.1 Reference data (ma'lumotnomalar)** — tenant-scoped CRUD for
      disciplines, levels, age categories, group types, ad sources, study
      goals, lead statuses (ordered + funnel stage + `is_won`/`is_lost`),
      churn reasons, payment types, payment methods, expense categories,
      holidays. Never hard-deleted — `is_active=false` only. — TZ M1.3
- [ ] **1.2 Classrooms + branch lifecycle** — classrooms (name, capacity,
      branch, equipment, `is_active`), branch CRUD completion (address,
      phone, working hours, timezone default `Asia/Tashkent`, auto-named
      abbreviation) and branch soft-delete. — TZ M1.1, M1.2
- [ ] **1.3 Employees + teacher profile** — full name, phone, email,
      role(s), branch(es), `is_active`; teacher profile (disciplines,
      levels, age categories, salary settings) and weekly **availability**;
      deactivation revokes all sessions and refresh tokens. — TZ M1.4
- [ ] **1.4 Custom fields** — `custom_field_definitions` +
      `custom_data JSONB` with a GIN index for student / lead / study_unit;
      backend validates `custom_data` against the definition (type,
      required, select variants). — TZ M1.5
- [ ] **1.5 Clients, contacts, students** — `clients`, `contact_persons`
      (with "invoice recipient" / "receives messages" flags),
      `contact_person_students`, `students` (one card per client per
      BR-S1); status derived from enrollments (BR-S3), `archived` instead
      of delete (BR-S2); **merge** in one transaction with a full audit
      diff and 24h undo via `merge_operations` (BR-S4). — TZ M3.1, M3.2
- [ ] **1.6 Study units + enrollments** — `study_units`
      (group|mini_group|individual, forming→active per BR-U2, capacity,
      `min_size`, color, version) and `enrollments` (status
      active|frozen|finished|transferred|cancelled, `payer_client_id`),
      **BR-E1 as a DB EXCLUDE constraint** on (student_id, study_unit_id,
      daterange), transfer semantics (BR-E2), cancel-only-if-no-charges
      (BR-E3). — TZ M4.1, M4.2
- [ ] **1.7 Schedule rules + lesson materialization** — `schedule_rules`
      (days_of_week, start/end time or academic hours per day + break, or
      total academic hours) → **materialized** `lessons` on a rolling 6
      month horizon via a nightly job; rule change regenerates only future
      lessons, never touches past ones, never overwrites a manually edited
      lesson (`is_detached=true`), never auto-cancels a lesson that has
      attendance or charges; holidays skipped.
      `POST /schedule-rules/:id/preview` returns the result + conflicts
      before saving. — TZ M4.3
- [ ] **1.8 Conflict control (critical)** — `lessons_classroom_no_overlap`
      and `lessons_teacher_no_overlap` EXCLUDE USING gist constraints
      (excluding `cancelled`/`moved`, on `actual_teacher_id`), btree_gist
      extension, constraint violation mapped to a `SCHEDULE_CONFLICT`
      error that returns **free alternative classrooms and time slots**;
      student conflict warns only. — TZ M4.4
- [ ] **1.9 Lesson operations** — move (`moved_to_lesson_id`), cancel with
      reason (no charge), substitute teacher (`actual_teacher_id`, one
      lesson or a period), makeup (`makeup_for_lesson_id`), and **bulk
      cancel** ("teacher is ill — cancel the next 3 days and notify").
      — TZ M4.5
- [ ] **1.10 Schedule views** — group schedule, by classroom, by teacher,
      free classrooms, free teachers (availability + conflict + discipline/
      level filters), interactive drag-and-drop calendar; the
      `(study_unit_id, start_at)`, `(classroom_id, start_at)`,
      `(actual_teacher_id, start_at)` indexes. — TZ M4.6, UX §P1
- [ ] **1.11 Attendance + lesson auto-complete** — the 7 statuses and
      their money effect, attendance matrix (student × date) with comments
      and test scores, the single **"attendance window"** model (teacher:
      15min before → 24h after; administrator: 7 days then
      `attendance.mark_past` + mandatory reason; payroll-approved periods
      locked behind `attendance.edit_locked`), BR-A1/A2/A4, lesson
      auto-`completed` once attendance is complete, `end_at + 2h` reminder,
      23:00 "awaiting attendance" list. — TZ M4.7, M5.1, M5.2, M5.3
- [ ] **1.12 Teacher PWA** — separate compact interface: today's lessons,
      one-tap attendance that works **offline** (IndexedDB queue, sync on
      reconnect, server version wins on conflict and the teacher is told),
      topic + homework entry, substitution request. — TZ M9.4, UX §5
- [ ] **1.13 Onboarding wizard** — new tenant productive in 15 minutes:
      branch + classrooms → disciplines + levels → prices → invite
      employees (SMS/Telegram link) → import students from Excel → first
      group. Every step skippable and resumable. — TZ M1.6

## Phase 2 — Moliya (R1)

Nothing in this phase may use `number` arithmetic for money — 0.4 first.

- [ ] **2.1 Prices + versioning** — `prices` (per_lesson, per_academic_hour,
      package, monthly, calendar; `academic_hour_minutes` default 45,
      `package_units`, `allow_partial_payment`, `validity_days`, branch/
      discipline/level scope, `valid_from/to`, `superseded_by_id`);
      editing a price creates a new version, existing enrollments keep
      their `price_id`, moving them is a separate explicit action with an
      `effective_from` date. — TZ M6.2
- [ ] **2.2 Discounts** — percent or fixed_amount at enrollment level with
      period and reason; percent applied before fixed; total discount can
      never exceed the price (no negative price); automatic discount rules
      (sibling 2+ active students, second course, N months prepaid) that
      apply visibly and can be revoked. — TZ M6.3
- [ ] **2.3 Ledger** — `ledger_entries` append-only (uuidv7 ids, signed
      `amount`, the 9 `entry_type`s, `source_type`/`source_id`,
      `reverses_entry_id`, `idempotency_key` UNIQUE per tenant), the
      `forbid_ledger_mutation` **statement-level trigger** raising
      `P0001` + `REVOKE UPDATE, DELETE, TRUNCATE ... FROM app_user`,
      `students.cached_balance` updated in the same transaction, and a
      nightly reconciliation job comparing it to `SUM(amount)` that raises
      a **critical** alert on any mismatch. — TZ M6.4
- [ ] **2.4 Charge engine (critical)** — the M6.6 algorithm triggered when
      a lesson becomes `completed` or when attendance changes on a
      completed lesson, driven by the `lesson_charges` projection
      (PK `(lesson_id, student_id)`, `current_entry_id`, `amount`,
      `revision`) so that a reversal followed by a new charge is possible;
      idempotency via `revision` and
      `idempotency_key = hash(lesson, student, revision)`;
      `calculate_amount` per price model incl. monthly pro-rata and the
      `absent_excused_charge_pct` setting. Property-based tests. — TZ M6.6
- [ ] **2.5 Invoices** — `invoices` (status draft|issued|partially_paid|
      paid|cancelled), `overdue` as a **computed** condition not a status,
      positions, manual / bulk-per-group / automatic issuing, FIFO or
      exact-invoice payment allocation, tenant-sequential gap-free numbers
      via `document_sequences` + `SELECT ... FOR UPDATE`, and a short
      public payment link `/p/<token>` valid 30 days with no login. — TZ M6.5
- [ ] **2.6 Manual payment + refund** — accept cash/card/transfer (amount,
      date, method, type, comment, who accepted, PDF/Telegram receipt);
      `entry_type=refund` with a mandatory reason behind its own
      permission, and **maker-checker** above a configurable threshold.
      — TZ M6.7, §3.3
- [ ] **2.7 Cash shifts** — open/close a shift, expected vs actual cash,
      collection, the difference shown at close and written to the audit
      log. — TZ M12.6, M6.7
- [ ] **2.8 Payme integration** — JSON-RPC 2.0 Merchant API
      (CheckPerformTransaction, CreateTransaction, PerformTransaction,
      CancelTransaction, CheckTransaction, GetStatement), HTTP Basic
      merchant key, idempotency on Payme transaction `id`,
      `provider_transactions` with its own created→performed→cancelled
      state machine, `UNIQUE (provider, provider_transaction_id)`, auth
      failures returning error `-32504` + alert, daily `GetStatement`
      reconciliation. Contract tests against the sandbox. — TZ M6.7
- [ ] **2.9 Click integration** — SHOP API two-step Prepare → Complete,
      MD5 `sign_string` verification, idempotency on `click_trans_id`,
      daily report reconciliation. — TZ M6.7
- [ ] **2.10 Write-off** — rounding remainders, expired packages and the
      unused part of a non-divisible subscription →
      `entry_type=write_off` with its own report. — TZ M6.8
- [ ] **2.11 Expenses** — branch expenses (category, amount, date,
      comment, receipt file), recurring expenses auto-added monthly,
      marketing expenses linked to an ad source for CAC. — TZ M6.9
- [ ] **2.12 Enrollment freeze** — `enrollment_freezes` (from, to, reason,
      `approved_by`); lessons in the period become `frozen` (no charge),
      monthly price pro-rated, seat not released, configurable yearly
      freeze-day limit, request from the parent cabinet + administrator
      approval. — TZ M12.1
- [ ] **2.13 Debtors report (aging)** — 0–30 / 31–60 / 61–90 / 90+
      buckets, advance remainders, per-branch/group/teacher breakdown,
      Excel export. — TZ M10.1
- [ ] **2.14 "Money at risk" desktop widget** — lessons with unmarked
      attendance (uncharged money), invoices due today, 30+ day debt
      total; each one click away from the underlying list. — TZ M12.11
- [ ] **2.15 Audit log** — `audit_log` (actor_id, action, entity_type,
      entity_id, `diff JSONB`, ip, user_agent, request_id, occurred_at),
      append-only by the same trigger pattern as the ledger, monthly
      partitions, ≥3 year retention; **mandatory** for financial
      operations, role/permission changes, contact viewing, retroactive
      attendance, payroll approve/reopen, bulk actions, export and
      super-admin support sessions. — TZ M11.3, §3.3

## Phase 3 — Kabinet + xabarlar (R1)

- [ ] **3.1 Notification infrastructure** — `outbox_events` written inside
      the business transaction + a worker that delivers them (never call a
      provider from inside a transaction), channel priority Telegram → SMS
      → Push → Email with **fallback per message type**, templates with
      validated variables per channel and language (uz/ru/en),
      `message_log` (channel, status, error, cost), anti-spam (max 5/day
      default, quiet hours 21:00–09:00 except criticals, digest for
      repeated events), retry with exponential backoff → dead-letter +
      alert. — TZ M8.1, M8.3, M8.4
- [ ] **3.2 Telegram linking + bot** — one-time deep link
      `t.me/<bot>?start=<token>` (72h, single use, stored hashed) sent by
      SMS, `/start <token>` → `contact_person.telegram_chat_id`, the
      `request_contact` button path with phone normalization, 403 →
      `telegram_blocked_at` + fallback to SMS. — TZ M8.2
- [ ] **3.3 SMS provider** — Eskiz.uz / Play Mobile adapter behind the
      channel abstraction, approved templates, length + segment count
      shown before sending, per-month cost log and spend alert. — TZ M8.1, R10
- [ ] **3.4 Automatic notifications** — lesson reminder, cancellation,
      schedule change, invoice issued, due date approaching, debt,
      payment accepted (with receipt), child attended, course finished,
      homework, and the **monthly parent report** (attendance %, scores,
      teacher comment) as one message. — TZ M8.4
- [ ] **3.5 Bulk messaging** — segment from a saved view or filter,
      preview, test send, scheduling, report; recipient count and SMS cost
      shown before sending, 500+ recipients requires confirmation. — TZ M8.5
- [ ] **3.6 Parent/student cabinet auth** — phone + SMS OTP (6 digits,
      5 min, 5 attempts, stored hashed, the response never reveals whether
      the number exists) and Telegram deep-link / Login; one parent, many
      children with profile switching. — TZ M9.1
- [ ] **3.7 Parent cabinet (PWA)** — home (next lesson, balance + "enough
      for N more lessons", messages), schedule, attendance, finance
      (online payment, receipt download), homework, results, profile,
      freeze request; `student_id` always taken from the session never the
      URL, a parent sees only children linked through
      `contact_person_students`, **IDOR tests in CI**. — TZ M9.2, M9.3
- [ ] **3.8 Documents** — HTML → PDF (Gotenberg/Playwright) templates with
      `{{student.full_name}}`-style variables, contract numbers
      tenant-sequential and gap-free via `document_sequences`, generated
      PDFs stored immutably with a hash so an old document never changes
      when its template does, and contract confirmation by OTP in the
      parent cabinet (simple e-signature). — TZ M3.3
- [ ] **3.9 Import** — students, leads, groups, enrollments, payments and
      **starting balances** (critical for migration): file → saved mapping
      template → dry-run validation → errors back as Excel → confirm →
      import; every import carries an `import_batch_id` and can be rolled
      back (records archived, ledger reversed); large files run as a
      background job with progress. — TZ M11.1
- [ ] **3.10 Export** — CSV/XLSX, large exports as a background job with a
      download link; exports obey permissions and branch scope, and
      contact fields are hidden without `*.view_contacts`. — TZ M11.2

## Phase 4 — Pilot (R1 ready)

- [ ] **4.1 Migration dry-run** — export and analyse the pilot's existing
      data, write the mapping document (old → new field), test-import on
      staging with a discrepancy report, load starting balances as
      `adjustment` entries with reason "migration", and reconcile every
      student against the old system with a signed-off result. — TZ §12.1
- [ ] **4.2 Load + security hardening** — 200 concurrent users with
      p95 < 300ms, heavy reports off OLTP tables (materialized views +
      `REFRESH CONCURRENTLY`), cursor-based pagination everywhere with
      `total` only on request (EXPLAIN estimate above 10 000), pentest
      with no critical/high findings. — TZ §8.1, M2.3, §13.2
- [ ] **4.3 R1 acceptance** — walk the whole §13.2 checklist on the pilot
      branch: group + schedule + 10 students in 5 minutes; 15-student
      attendance in 20 seconds from a phone, offline included; conflicts
      caught at DB level with alternatives offered; charges correct for
      every price model including monthly and freeze; balance always equal
      to `SUM(ledger)` for 30 days; parent pays by Payme/Click and gets a
      receipt; debt reminders respect quiet hours; cash shift shows its
      difference; migration balances 100% matched. — TZ §13.2
- [ ] **4.4 One month parallel run** — pilot branch runs on both systems,
      fixes only. Attendance, balance and payroll must match 100% before
      the second branch is onboarded and before R2 starts. — TZ §1.3, §12

## Phase 5 — CRM (R2)

- [ ] **5.1 Inbound submissions + UTM** — `inbound_submissions` (source,
      form_id, `raw_payload JSONB`, utm_source/medium/campaign/content/term,
      referrer, landing_url, ip, status new|processed|spam|archived),
      `POST /api/v1/public/inbound` with rate limit + captcha + honeypot,
      Telegram bot / import / webhook (Tilda, landing) sources; UTM **and**
      the manually chosen ad source both stored; duplicate detection by
      normalized phone attaches a new lead to the existing client and
      notifies its owner. — TZ M2.2
- [ ] **5.2 Leads** — the M2.1 entity and BR-L1…BR-L5 (several leads per
      client, no payment or contract on a lead, automatic actions never
      move the status backwards, manual changes logged to
      `lead_status_history`, mandatory loss reason on `is_lost`, SLA on
      `first_contact_at` escalating at N and 2N minutes). — TZ M2.1
- [ ] **5.3 Lead list + funnel** — filters, table/kanban views, saved
      views, bulk actions (status, owner, tag, message, export),
      cursor-based pagination. — TZ M2.3, UX §P1
- [ ] **5.4 Trial lessons** — book a lead into an existing lesson with
      `trial` attendance status: takes a seat, creates no charge; outcome
      came / did not come / came and enrolled triggers the matching event;
      configurable max trials per lead (default 1). — TZ M2.4
- [ ] **5.5 Lead → student conversion** — `is_won` → client found or
      created → contact, source and preferred schedule carried over →
      enrollment created → `lead.student_id` linked, **all in one DB
      transaction** behind an `Idempotency-Key`. — TZ M2.5
- [ ] **5.6 Tasks** — text, owner, due date, linked entity, importance,
      result; recurring tasks via RRULE; configurable mandatory result on
      completion. — TZ M2.6
- [ ] **5.7 Auto-actions engine** — trigger → condition → action over the
      M2.7 event catalogue, running on the phase-3 outbox; actions
      change_status, create_task, send_message, assign_owner (round-robin /
      by load / fixed), add_tag, call_webhook, wait; `automation_runs` log,
      idempotency on `hash(automation_id, event_id, action_index)`,
      **cycle protection** via `causation_depth` (chain stops above 3) and
      a dry-run preview ("how many times would this rule have fired in the
      last 30 days"). — TZ M2.7

## Phase 6 — Retention (R2)

- [ ] **6.1 Payroll** — the 7 calculation methods (fixed_salary, hourly_flat,
      hourly_per_unit, hourly_by_attendance, revenue_percent, per_student,
      hybrid), `payroll_period` → calculate → `payroll_entries` → approve →
      pay with a `calculation_snapshot JSONB` on every entry, statuses
      draft→calculated→approved→paid (recalculation blocked after approve,
      `reopen` audited), salary follows `lesson.actual_teacher_id`.
      **Resolve first:** is `revenue_percent` accrual- or cash-based
      (QUESTIONS.md). — TZ M7.1, M7.2, M7.4, M7.5
- [ ] **6.2 Payroll adjustments** — bonus, penalty, advance, deduction with
      mandatory reason and owner; KPI bonus rules (e.g. group retention
      ≥90% → +X). — TZ M7.3
- [ ] **6.3 Teacher salary transparency** — live estimated salary in the
      teacher cabinet during the month (lessons taught × rate) with a
      per-lesson breakdown. — TZ M7.6
- [ ] **6.4 Churn risk** — a rule-based, explainable score (consecutive
      absences +30, 30-day attendance <60% +25, 14+ days of debt +20,
      falling test scores +15, course ending in 14 days with no next
      course +10); ≥50 → "at risk" list + a task for the manager; every
      point shows **why**. — TZ M12.4
- [ ] **6.5 Waitlist** — `waitlist_entry` for full groups; a freed seat
      offers it to the first in line for 24h (Telegram/SMS) before moving
      on, plus a "9 people waiting" signal for opening a new group.
      — TZ M12.2
- [ ] **6.6 Household** — `households` + `payer_client_id`: one payment
      split across several children, shared debt in the cabinet, automatic
      sibling discount, while the ledger stays per-student via
      transfer_in/transfer_out. — TZ M12.3
- [ ] **6.7 Installment plans** — split a package or course price into a
      schedule (e.g. 3 × 1 200 000) with automatic reminders per due date
      and `installment.overdue` on lateness; the debtors report separates
      "behind schedule" from "total debt". — TZ M12.5
- [ ] **6.8 Omnichannel chat** — Telegram → CRM inbox, internal chat, group
      chat, round-robin assignment, SLA timer, quick-reply templates.
      — TZ M8.6
- [ ] **6.9 Curriculum** — topic list per course (lesson 1…N), teacher marks
      the topic when finishing a lesson, group **behind schedule** visible,
      "course 45% complete" in the parent cabinet, homework template per
      topic. — TZ M12.8

## Phase 7 — Analitika va SaaS (R3)

- [ ] **7.1 Financial + sales + load reports** — revenue, charges, payment
      statistics, advance remainders, sales plan, expenses, profitability
      (branch/discipline/group), operation history, cash shifts, 30-day
      cash-flow forecast; funnel, status changes, sources with CAC, loss
      reasons, manager efficiency; classroom occupancy heatmap (day ×
      hour), teacher load, lesson statistics. — TZ M10.1, M10.2, M10.3
- [ ] **7.2 KPI dashboard** — retention, churn, cohort retention, LTV,
      ARPU, conversion, group fill, attendance %, collection rate; every
      KPI carries its formula behind an "i" marker; served from
      materialized views / a read replica, every report exportable to
      Excel. — TZ M10.4
- [ ] **7.3 Certificates** — PDF from a template on course completion
      (minimum attendance + test score), QR code and a **public
      verification page** `/verify/<code>`. — TZ M12.7
- [ ] **7.4 NPS** — one Telegram question (0–10) + optional comment monthly,
      sliced by teacher and branch, score ≤6 creates a task automatically.
      — TZ M12.9
- [ ] **7.5 Public API + outgoing webhooks** — tenant API keys (scoped,
      stored hashed), OpenAPI documentation, outgoing webhooks
      (`student.enrolled`, `payment.received`, …) signed with HMAC, with
      retry and a delivery log. — TZ M12.10
- [ ] **7.6 Uzum Bank** — third payment provider behind the same provider
      abstraction. — TZ M6.7
- [ ] **7.7 Multi-tenant SaaS onboarding** — self-service tenant signup,
      plans and limits, billing, super-admin support sessions (audited).
      — TZ §1.5
- [ ] **7.8 Telephony** — call integration on the lead and student cards.
      — TZ §9

---

## Out of scope (all releases) — TZ §1.4

Full LMS (video hosting, interactive exercises, auto-graded tests); native
mobile apps (PWA + API only); 1C / tax reporting integration and online
fiscal receipts (separate legal analysis); library, excursion, exam modules,
loyalty points, corporate (B2B) section.

## Blocking before R1 ships

- Role permission × scope matrices need product sign-off — they decide who
  can see money (`docs/QUESTIONS.md`, phase 0.3).
- Personal-data law (TZ §8.4, risk R3) needs a lawyer's opinion **before**
  the parent cabinet stores contact data in production.
- Payme / Click merchant accounts and approved Eskiz SMS templates must
  exist before phase 2.8 and 3.3 can be tested for real.
