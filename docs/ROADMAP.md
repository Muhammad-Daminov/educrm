# EduCRM R0 Roadmap
Rules: CLAUDE.md. Spec: docs/TZ_EduCRM_v2_0.pdf + docs/UX_Spec_EduCRM_v2_0.pdf.
Full R1–R3 plan for later: docs/ROADMAP-full.md (do NOT work from it now).
Take the FIRST unchecked task. Do only that task. Commit after each sub-item.
When done: run lint+typecheck+test, append summary to docs/PROGRESS.md, check the box, commit, STOP.
R0 = no Payme/Click, no parent portal, no Telegram/SMS, no payroll, no CRM/leads, no 2FA, no offline PWA.

## Decisions (already made)
- Roles: administrator and teacher do NOT get finance.view_amounts. Other defaults as inferred.
- Price models in R0: monthly (with pro-rata) and per_lesson only.
- UI language: uz (latin) only for R0, but all texts via i18n keys.
- Uzbek letters: `oʻ`/`gʻ` use U+02BB MODIFIER LETTER TURNED COMMA; the tutuq
  belgisi (`maʼlumot`) uses U+02BC MODIFIER LETTER APOSTROPHE. Search and sort
  normalize `'` `’` `‘` `ʻ` `ʼ` `` ` `` to one form (TZ 8.5) — see
  `uzSearchKey`/`compareUzbek` in `packages/shared/src/uz-text.ts`.
- audit_log partitions: a monthly worker job keeps >= 3 months of future
  partitions.
- Web dev server port is 3100, permanently (3000 belongs to another project).

- [x] T01–T03 Skeleton, RLS, auth + RBAC (done)

- [x] T04 Foundation finish
  Money value object in packages/shared (bigint, add/sub/mul by ratio, allocate with
  remainder to last item, format "1 250 000 so'm"); lint rule banning number math on money.
  audit_log table (append-only trigger) + AuditService.
  outbox_events table + BullMQ worker skeleton (APP_ROLE=api|worker), retry with backoff,
  dead-letter, idempotency by event id. GitHub Actions CI: lint, typecheck, test.
  UI shell from UX §2: sidebar (menu from /auth/me permissions), topbar, branch selector,
  Ctrl+K command palette (navigation only), toast, empty/error/loading state components.
  Cleanup: fix "/api/v1/*" middleware path warning (named wildcard "/api/v1/{*path}");
  POST /auth/login and /auth/refresh return 200, not 201.

- [x] T05 Organization + reference data
  CRUD + UI (UX P1 list with filter chips + URL state, P6 forms in drawer):
  branches, classrooms, employees (create, roles, branches, deactivate = revoke sessions),
  teacher profile (disciplines, levels), disciplines, levels, age categories,
  payment methods, holidays. Archive instead of delete. RLS + RLS test per table.

- [ ] T06 Students
  clients, client_phones (E.164), contact_persons, students (TZ M3), duplicate detection
  by phone on create, list with filters, student card with tabs (UX P2), archive.
  Excel/CSV import: upload → mapping → dry-run error report → confirm, import_batch_id,
  rollback (archive) by batch.

- [ ] T07 Groups + enrollments
  study_units (TZ M4.1), enrollments (M4.2) with EXCLUDE constraint, add/remove member,
  transfer, capacity warning, group list (UX 4.3) and group page with members.

- [ ] T08 Schedule
  schedule_rules, lessons materialized (rolling 6 months, nightly extend job, skip holidays,
  is_detached protection, never auto-delete lessons with attendance/charges).
  Exclusion constraints for classroom and actual_teacher_id (exclude cancelled, moved).
  POST /schedule-rules/:id/preview. SCHEDULE_CONFLICT error with free alternatives.
  Lesson actions: move, cancel (reason), substitute teacher, extra lesson.
  UI: group wizard schedule step with live preview; week calendar (by classroom / teacher),
  drag to move with conflict feedback; free classrooms finder.

- [ ] T09 Attendance
  attendances (UNIQUE lesson+student), statuses TZ M5.1, windows TZ M5.3
  (teacher 15 min before → 24h after; admin 7 days; older: attendance.mark_past + reason).
  Lesson auto-complete when fully marked; reminder job for unmarked lessons.
  Teacher mobile page (UX §5.1–5.2, responsive, "Hammasi keldi" one tap).
  Attendance matrix (UX P5), "unmarked lessons" list. Emit lesson.completed via outbox.

- [ ] T10 Finance core (CRITICAL — highest test bar)
  prices (versioned, monthly + per_lesson), discounts (percent/fixed, total <= price).
  ledger_entries per TZ M6.4 with immutability trigger + REVOKE.
  lesson_charges projection + charge engine per TZ M6.6 (on lesson.completed and attendance
  change), monthly pro-rata per TZ M6.2, absent_excused setting.
  cached_balance in same transaction; nightly reconciliation job.
  Tests: TZ 10.3 FINANCE scenarios for R0, property-based (fast-check)
  SUM(ledger)==cached_balance over 10k random ops.

- [ ] T11 Payments + debtors
  Manual payment (drawer, 3 fields, UX 4.6), refund (reason, permission), ledger adjustment
  (reason, audit), Idempotency-Key on money POSTs (TZ 6.4).
  Student Finance tab: balance in so'm + lessons equivalent, ledger with reversal pairs.
  Debtors list with aging buckets, export. Printable receipt (HTML print).
  Dashboard "money at risk" widget (UX 4.0).

- [ ] T12 Release prep
  Demo seed (1 tenant, 2 branches, 10 groups, 150 students, 2 months history).
  Playwright e2e: login, group+schedule, attendance, payment, debtors.
  Production docker-compose (api, worker, web, postgres, pgbouncer, redis, caddy TLS),
  daily pg_dump backup + restore test script, Sentry, deploy README.
