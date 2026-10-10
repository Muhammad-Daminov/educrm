# Progress

## Step 0.3 — authentication + RBAC (2026-10-09)

**Done:** Full auth stack — users/sessions/roles/role_permissions/
user_roles/user_branches with the standard RLS pattern, TZ 3.2 permission
catalog + six system role templates, `auth_find_user` SECURITY DEFINER
login lookup, Argon2id + 15min access JWT + 30day rotating refresh tokens
with family reuse detection, httpOnly cookies, CSRF double-submit, global
default-deny permission guard with Redis-cached effective permissions,
Redis login rate limiting + account lockout, `seed:owner` CLI, and the web
login page / protected layout / silent refresh behind a Next same-origin
rewrite. 36 tests pass (12 new full-stack auth integration tests that boot
a real Nest app against throwaway Postgres + Redis).

**Decisions:** X-Tenant-Id resolver fully removed — tenant_id now comes
only from the verified access token. `users` is deliberately ENABLE-but-not-
FORCE RLS (the single documented bypass, required by `auth_find_user`).
Login returns one generic error for unknown tenant / unknown login / wrong
password / inactive user to prevent enumeration. `/auth/login` is the only
CSRF-exempt non-GET route (the browser can't have the cookie yet). Role
permission×scope matrices are inferred from TZ prose — see docs/QUESTIONS.md.

**Open questions:** Role templates need product sign-off before release
(they decide who can see money). Real tenant selection still stubbed on an
env var. `ALL_PERMISSION_CODES` in role-templates.ts and the catalog in the
auth migration are kept in sync by hand with no automated check. The web
login flow was verified end-to-end over HTTP (login → me → refresh →
logout, uz texts rendered, cookies same-origin) but was *not* clicked
through in a real browser — no browser tooling was available this session.

## docs/ROADMAP.md — the task queue itself (2026-10-09)

**Done:** Created `docs/ROADMAP.md`, the task queue `CLAUDE.md` has pointed
at since the start but which had never existed (confirmed: no commit in
`git log --all` ever touched it). It derives 8 phases / 63 tasks from TZ §12
(phase table), §4 (M1–M12) and §13.2 (R1 acceptance), each task naming the
TZ sections to read first. 0.1 / 0.2 / 0.3 are checked off against what is
actually in the repo; the first unchecked task is **0.4 Money value object**.

**Decisions:** Phase boundaries follow TZ §12 verbatim (Poydevor → Akademik
yadro → Moliya → Kabinet → Pilot → CRM → Retention → Analitika) rather than
a flat list, so the R1/R2/R3 gates stay visible. Tasks are sized as one
vertical slice = one commit, like step 0.3. `Money` is deliberately ordered
before the whole finance phase — nothing in phase 2 may be written without
it. 2FA, which TZ §12 puts in phase 0 but step 0.3 scoped out, is kept as an
explicit unchecked 0.6 required before R1 ships, not before phase 1 starts.
Three real blockers (role-matrix sign-off, personal-data legal opinion,
provider merchant accounts) are listed at the bottom instead of being buried
in the tasks that depend on them.

**Open questions:** Phase durations from TZ §12 (3–5 weeks each, ~20 weeks
to R1) are not reproduced per task — the estimates assume 2–3 fullstack devs
plus a designer, which does not describe this setup, so task order is
authoritative and timing is not. TZ §12 phase 0 also lists "monitoring" and
"CI/CD" which were never done in 0.1 — folded into 0.5 rather than
backdated. Whether `revenue_percent` payroll is accrual- or cash-based is
still unanswered in TZ M7.1 and is flagged on task 6.1.

## T04 — Foundation finish (2026-10-09)

**Done:** `Money` in packages/shared (bigint tiyin; `mulRatio` takes an
integer ratio and rounds half away from zero; `allocate` gives the division
remainder to the last part so splits sum back exactly, proved over every
amount in -500..500 tiyin × 1..9 parts; `format()` per UX §7; `toJSON()` as
a tiyin string per TZ 6.1) plus the `educrm/no-money-number-arithmetic` lint
rule TZ M6.1.5 demands — type-aware, error-level for every package, 22
RuleTester cases. `audit_log` with TZ M11.3's exact format, append-only via
trigger *and* REVOKE, monthly partitions, standard RLS, and an AuditService
whose `record(entry, tx)` commits with the change it describes.
`outbox_events` + the APP_ROLE=api|worker split, with retry/backoff/
dead-letter owned by the outbox row rather than BullMQ and idempotency by
event id. GitHub Actions CI (lint, typecheck, test) + `postinstall: prisma
generate`. The UX §2 app shell: permission-built sidebar, topbar, branch
selector, Ctrl+K palette, toast, and the §3.8 loading/empty/error/forbidden
states. Cleanup: named wildcard routes (0 boot warnings, was 3) and 200 on
the auth POSTs. 204 tests pass (49 web, 96 api, 29 shared, 22 config, 8
pre-existing web), and the shell was driven in a real headless Chrome —
login, permission-filtered menus for owner vs administrator, Ctrl+K filter
and navigate, sidebar collapse persistence, branch selection persistence,
and `/settings` as an administrator rendering "Ruxsat yo'q" instead of 404.

**Decisions:** Retries live on the outbox row, not in BullMQ (jobs get
`attempts: 1`), so one place decides when an event is tried again; job ids
are `<eventId>-attempt-<n>` because BullMQ remembers completed ids and would
drop a retry reusing the bare one. An event type with no registered handler
retries and then dead-letters rather than being marked done — silently
dropping a domain event is how a charge never gets posted. `audit_log` has
no DEFAULT partition on purpose (see docs/QUESTIONS.md). The dispatcher
polls per tenant rather than taking a BYPASSRLS role. The dashboard lives at
`/`, not UX §1.1's `/home`, since UX §0.3 puts URL structure outside what is
copied from the reference. R2 sections (Sotuv, Maosh, Kommunikatsiya,
Hisobotlar) are absent from the menu rather than present and dead. The old
`(app)/page.tsx` profile screen moved to `/profile`, reachable from the
avatar menu. `destructive` was added to the Tailwind theme — it was
referenced by the existing login page but defined nowhere, so
`text-destructive` had been doing nothing.

**Open questions:** Six judgment calls recorded in docs/QUESTIONS.md, of
which two want attention before R0 ships: Uzbek text still uses ASCII
apostrophes where UX §8 wants `oʻ`/`gʻ` (one decision, two files), and
`audit_log`'s partition runway ends 2029-10 with no scheduler calling
`ensure_audit_log_partition`. Also deferred by scope, not oversight: the
topbar's global search is only a palette trigger until there are entities to
search (T06/T07); the bare-key shortcuts in UX §2.4 (`/`, `N`, `G`+letter,
`J`/`K`) need the list screens they act on; chat and notification bells are
out of R0. The toast component ships with no caller yet — the first real one
is T05's create/edit drawers.

## Product-owner decisions, 2026-10-09 (pre-T05)

**Done:** Three decisions landed as three commits. (1) Uzbek orthography:
`oʻ`/`gʻ` are U+02BB, tutuq belgisi is U+02BC; every existing UI text and
`Money`'s `soʻm` suffix converted, with `uzSearchKey`/`compareUzbek`/
`normalizeApostrophes` in `packages/shared` as the one definition of the
TZ 8.5 fold for search and sort, and a web test that fails the build on any
ASCII or curly stand-in. (2) `AuditPartitionService`: a worker job keeping
the current month plus 3 future `audit_log` partitions, checked at startup
and every 24h, with `ensure_audit_log_partition` made SECURITY DEFINER so
the worker needs no `migrator` credentials. (3) Web dev server on 3100
permanently. 229 tests pass (119 web, 113 api, 45 shared, 22 config).

**Decisions:** The search/sort key *drops* the mark rather than folding it
to U+02BB — `oquvchi` has to find `Oʻquvchi`, and `Gʻafurov` has to sort
between `Fozilov` and `Hasanov` instead of after every ASCII name;
`normalizeApostrophes` is the fold-to-one-character variant, for imported
data. Partition maintenance is checked daily, not monthly: "monthly"
describes the partitions, and a job firing only on the 1st gets twelve
chances a year to be asleep during a deploy. Granting `app_user` EXECUTE on
one SECURITY DEFINER DDL function was chosen over giving a long-running
process the `migrator` role — the privilege gained is exactly "create the
audit_log partition for month X", and it reads no rows, so it is not an RLS
bypass like `auth_find_user`.

**Open questions:** Postgres `ORDER BY name` does not get the TZ 8.5 fold
for free — T05/T06 list endpoints must either sort through `compareUzbek`
in the service or add a normalized sort column; noted in docs/QUESTIONS.md.
Two QUESTIONS entries are now closed (apostrophes, partition runway), four
remain open.

## Step T05 — organization + reference data UI (2026-10-10)

**Done:** Finished the T05 screens on top of the WIP data layer/API from
the previous session: branches, classrooms (branch-scoped picker,
`branchId` locked after create), disciplines, levels (discipline picker +
"barcha fanlar" filter), age categories, payment methods, and holidays
(branch picker + "barcha filiallar" filter) all run through the shared
`ResourceScreen`/`ResourceFormDrawer` (UX P1 list + P6 drawer, URL-held
filters, archive/restore). Employees got a bespoke screen instead —
deactivate/activate rather than archive/restore, plus three PUT
sub-resources (roles, branches, teacher profile) reusing `ResourceFormDrawer`
for each. `/settings` groups the five reference lists behind tabs, gated
once on `settings.manage`. Fixed three pre-existing lint failures left over
in the WIP commit (money-arithmetic name heuristic false positive in
`totalPages`, unsafe `any` from `Array.isArray` narrowing `unknown` to
`any[]`, base-to-string on a `row[field]` read) and a latent type bug in
`ResourceScreen`'s generic constraint (`T extends ArchivableRow &
Record<string, unknown>` rejects any plain row interface — interfaces
without an explicit index signature aren't assignable to `Record<string,
unknown>` in strict mode, even though plain object types are).

**Decisions:** Default roles grant create/update/archive for a resource
all-or-nothing (confirmed against the TZ 3.1 role templates), so each
screen's `canWrite` collapses those three permissions into one UI flag
rather than gating each button separately — the backend still checks every
call on its own permission regardless. Reference-data writes have no
version header on the three employee sub-resources (roles/branches/teacher
profile aren't optimistic-locked server side), so those drawers call PUT
without an `If-Match`.

**Open questions:** None new. Pagination here is offset-based per the
existing list-query contract; the instruction to keep cursor pagination
ready for students/lessons/ledger (TZ 6.1) is unaffected since those
endpoints don't exist yet.

## T05 follow-up — remove unknown-casts, handle ref-data load errors (2026-10-10)

**Done:** `ArchivableRow`/`EmployeeRow` got an index signature so
`ResourceScreen`/`EmployeesScreen` pass their row generic to
`ResourceFormDrawer` without `as unknown as Record<string, unknown>`;
added an apps/web `no-restricted-syntax` ESLint rule banning that cast
pattern. The branch/discipline/role reference-data loads in classrooms,
holidays, levels and `EmployeesScreen` had no `.catch` — a failed fetch
left the screen spinning forever — now they render UX §3.8's `ErrorState`
with retry. Full lint+typecheck+test pass (5/5 packages).

**Decisions:** Fixed the type mismatch via an index signature on the row
interfaces rather than loosening `ResourceFormDrawer`'s prop type, so the
constraint still catches a row missing a required field at the call site.

**Open questions:** None new.

## T06 wrap-up — verify after crash recovery (2026-10-10)

**Done:** previous session crashed (VS Code closed) after commit
454e75a while running the full test suite; working tree was already clean
at that commit, so no uncommitted work to recover. Re-ran lint + typecheck
+ test from scratch: all green (4/4 lint, 4/4 typecheck, 25 test files /
310 tests passed). Checked the T06 box in docs/ROADMAP.md.

**Decisions:** none new — this was a verification-only pass, no code
changed.

**Open questions:** none new.
