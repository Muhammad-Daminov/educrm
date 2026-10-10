# Open questions and judgment calls

Per CLAUDE.md: when a requirement is ambiguous or contradicts the spec,
record it here and pick the safest option. Never invent business rules for
money.

## Step 0.3 — auth + RBAC

### Login returns one generic error for four different failures
**Ambiguity:** TZ doesn't say whether "unknown tenant", "unknown login",
"wrong password" and "inactive user" should be distinguishable.
**Decision (safest):** all four return the identical
`401 INVALID_CREDENTIALS` / "Invalid tenant, login, or password". Rate
limiting is also keyed on the raw `(tenant_slug, login)` input rather than a
resolved user id, so timing and lockout behave the same whether or not the
account exists. Distinguishing any of them would let an attacker enumerate
valid tenant slugs and logins.
**Revisit if:** product explicitly wants a distinct "your account is
disabled, contact your administrator" message. That leaks which logins are
real, so it needs a deliberate decision.

### `/auth/login` is exempt from the CSRF double-submit check
**Contradiction:** requirement C says CSRF is required on *all* non-GET
requests, but a browser cannot have a CSRF cookie before its first
successful response from the API — the very request that issues one.
**Decision:** `@SkipCsrf()` on `/auth/login` only. Every other non-GET
route, including `/auth/refresh` and `/auth/logout`, keeps the check,
since login has issued the cookie by the time those are reachable.

### `auth.me` / `auth.logout_all` are not in the TZ 3.2 permission catalog
**Ambiguity:** requirement E says every route needs `@RequirePermission` or
`@Public`, but `/auth/me` needs *a* logged-in user and has no natural
`resource.action`, and it isn't a catalog permission.
**Decision:** a small `SELF_SERVICE_PERMISSIONS` set (`auth.me`,
`auth.logout_all`) that any authenticated, active user satisfies. These are
not backed by `permissions` rows. They are still *authenticated* routes —
not `@Public()` — so the default-deny guard and the CI scanner both still
apply.

### Role template permission×scope matrices are inferred, not specified
**Ambiguity:** TZ 3.1/3.2 describe each role's *intent* in prose ("O'z
filiali: to'liq") and list the permission catalog, but never give an exact
permission×scope matrix per role.
**Decisions taken in `apps/api/src/auth/role-templates.ts`:**
- `owner` — every catalog permission at `all` scope.
- `branch_manager` — every permission at `branch` scope *except*
  `role.manage`, `settings.manage`, `api_key.manage`, `audit.view`. Those
  four are org-wide/owner-level concerns regardless of branch, so "full
  within their own branch" shouldn't include them.
- `accountant` — finance permissions at `all` scope (finance is
  org-wide in TZ's reporting model, not per-branch).
- `administrator`, `sales_manager` — operational subset at `branch` scope.
- `teacher` — own-scope only (`schedule.view`, `attendance.view`,
  `attendance.mark`, `lesson.complete`, `payroll.view_own`).
**Revisit:** these need product sign-off before any customer-facing
release. Scope choices here affect who can see money (`finance.view_amounts`,
`payroll.*`), so they are the riskiest guesses in this step.

### `users` is the one table with RLS but not FORCE
**Decision:** documented at length in
`prisma/migrations/20261008135152_auth/migration.sql`. `auth_find_user`
(SECURITY DEFINER, owned by `migrator`) must search across tenants by slug
during login, before any `app.current_tenant` can exist. Omitting `FORCE`
exempts only the table *owner*; `app_user` is never the owner, so every
query the running API makes against `users` is still fully tenant-scoped.
This is the only RLS bypass in the schema.

### Tenant slug on the web client comes from an env var
**Scope note:** requirement B says the web app reads `tenant_slug` from
`DEFAULT_TENANT_SLUG` "for now". Implemented as
`NEXT_PUBLIC_DEFAULT_TENANT_SLUG`. Real tenant selection (subdomain, or a
slug field on the login form) is out of scope for step 0.3.

## T04 — foundation finish

### ~~Uzbek apostrophes are ASCII, not the proper modifier letters~~ CLOSED
**Contradiction:** UX §8 requires "Lotin yozuvi, oʻ va gʻ toʻgʻri belgilar
bilan" — the real characters in `oʻ`/`gʻ`. Everything shipped up to T04
(`lib/i18n.ts`, `Money.format()`'s `soʻm` suffix) used the ASCII `'`.
**Resolved (product owner, 2026-10-09):** `oʻ`/`gʻ` are U+02BB MODIFIER
LETTER TURNED COMMA; the tutuq belgisi (`maʼlumot`, `sanʼat`) is U+02BC
MODIFIER LETTER APOSTROPHE. They are different characters and not
interchangeable. Every existing UI text was converted, and
`apps/web/test/i18n.spec.ts` now fails the build if any translation falls
back to `'`, `’`, `‘`, `` ` `` or `´`.
Search and sort normalize the whole family (TZ 8.5) through
`uzSearchKey`/`compareUzbek` in `packages/shared/src/uz-text.ts`: the mark
is dropped entirely in the comparison key, so `oquvchi` finds `Oʻquvchi`
and `Gʻafurov` sorts between `Fozilov` and `Hasanov` instead of after every
ASCII name. `normalizeApostrophes` folds variants to U+02BB for imported
data, where the mark must be kept but its spelling must not vary.
**Note for T05/T06 list endpoints:** ordering done in Postgres does *not*
get this for free — `ORDER BY name` sorts on raw code points. Either sort
through `compareUzbek` in the service, or add a normalized sort column.

### Sidebar collapse and branch selection live in localStorage
**Contradiction:** UX §2.2 says the collapsed sidebar state is "foydalanuvchi
profilida saqlanadi — qurilmalar orasida bir xil" (on the user profile, same
across devices). The branch context is described as global in the same way.
**Decision:** both are in `localStorage`, per device, because there is no
user-settings endpoint until T05. Keys are scoped by user id
(`educrm.branch.<userId>`) so switching accounts on a shared machine cannot
inherit the previous user's branch.
**Revisit:** T05, which adds the employee/settings surface — moving these to
the server is then a small change behind the same provider API.

### A stale branch selection is dropped rather than honoured
**Judgment call:** a branch id persisted locally may name a branch the user
has since lost access to. `BranchProvider` ignores a stored id that is not
in the `/auth/me` branch list and falls back to "Barcha filiallar", rather
than showing a branch they can no longer use. The backend scope check is
unaffected either way (CLAUDE.md: permission checks are backend-only).

### ~~audit_log partitions run out in 2029-10~~ CLOSED
**Scope note:** the migration pre-creates 36 monthly partitions and
deliberately creates no DEFAULT partition — emptying one later needs a
DELETE, which the append-only trigger correctly refuses, so a missing month
has to fail loudly instead of silently absorbing rows.
`ensure_audit_log_partition(date)` is the idempotent maintenance entry
point; it must be called on a schedule before the runway ends.
**Resolved (product owner, 2026-10-09):** a worker job owns it —
`AuditPartitionService` keeps the current month plus 3 future months
(`apps/api/src/audit/audit-partition.service.ts`), running at worker
startup and then every `AUDIT_PARTITION_CHECK_INTERVAL_MS` (default 24h).
Checking daily rather than monthly is deliberate: "monthly" describes the
partitions, and a job that only fires on the 1st gets twelve attempts a
year to be asleep during a deploy. Covered by
`test/audit-partition.spec.ts` and `test/integration/audit-partition.spec.ts`
(creates the missing months, idempotent, survives concurrent passes, and
the new partition is writable by `app_user` under RLS).

**Side decision — how the worker gets DDL rights.** The function is DDL and
the app connects as `app_user`, which owns nothing. Rather than hand a
long-running network-facing process the `migrator` credentials (unrestricted
DDL over the whole schema), `ensure_audit_log_partition` became SECURITY
DEFINER with `SET search_path = public, pg_temp` and EXECUTE granted to
`app_user` alone — so the privilege gained is exactly "create the audit_log
partition for month X". It reads no rows, so unlike `auth_find_user` it is
not an RLS bypass. Migration:
`prisma/migrations/20261009140000_audit_log_partition_maintenance`.

### The outbox dispatcher polls once per tenant per tick
**Judgment call:** `outbox_events` carries FORCE row level security like
every other tenant table, so no connection — not even the table owner's —
can select pending work across all tenants at once. The alternatives were a
BYPASSRLS role or a second SECURITY DEFINER escape hatch alongside
`auth_find_user`; instead the dispatcher enumerates `tenants` (the one table
with no tenant_id and no RLS) and claims inside each tenant's own context.
Cost is linear in tenant count: nothing at R0's single pilot tenant, wrong
at several hundred.
**Revisit:** before onboarding tenants in bulk. LISTEN/NOTIFY, or a
tenant-agnostic "has pending work" signal, replaces the sweep without giving
up the isolation guarantee.

### An unknown in-app path is a client-side 404, not an HTTP 404
**Judgment call:** UX §1.2 requires that a section the user lacks permission
for shows "Ruxsat yo'q" rather than 404 — which means the decision needs the
user's permissions, which the client has and the server does not (the
session lives in an httpOnly cookie read by the API, not by Next). So the
catch-all route resolves access in the browser: unknown paths call
`notFound()` and render Next's 404 UI, but the document itself was already
served as 200. Acceptable because every one of these routes is behind a
login and none is indexable.

## T07 — groups + enrollments

### `default_price_id`/`price_id`/`curriculum_id`/`contract_id`/`payer_client_id`/`discount_ids` are omitted
**Scope note (already accepted, not an ambiguity):** prices/discounts are
T10, contracts and payer-vs-student billing are T10/T11, and nothing in R0
reads a curriculum. These columns are absent from `study_units` and
`enrollments` entirely rather than added as unused nullable FKs. Additive
later.

### BR-U1/BR-U2 are not enforced — schedule_rules doesn't exist yet
**Contradiction with spec intent, safest option taken:** BR-U1 ("no lessons
generated while `forming`") is moot — there are no lessons in R0 at all
(T08). BR-U2 ("forming→active requires a schedule rule to exist") cannot be
checked against anything, since `schedule_rules` is T08 and the table
doesn't exist. Rather than invent a stand-in check (e.g. "block unless at
least one enrollment exists", which isn't what BR-U2 says and would be a
fabricated rule), `forming→active` is allowed unconditionally. This is a
known, deliberate gap:
**Revisit:** when T08 ships, forming→active should require
`schedule_rules` to exist for the study unit, per the original BR-U2 text.

### The study_unit status transition graph beyond BR-U2
**Ambiguity:** the spec only pins down forming→active (BR-U2). Every other
edge is this task's own call.
**Decision:** `forming → {active, cancelled}`; `active → {paused, finished,
cancelled}`; `paused → {active, finished, cancelled}`; `finished` and
`cancelled` are terminal (no transitions out). Enforced in
`StudyUnitsService.changeStatus` via `ALLOWED_STUDY_UNIT_TRANSITIONS`.

### The enrollment status machine
**Ambiguity:** TZ M4.2 lists the five statuses but not a transition graph.
**Decision:** `active ↔ frozen`; `active`/`frozen` → `finished` or
`cancelled`; `transferred` is only ever set by the transfer flow (BR-E2),
never by a direct status call; `finished`/`cancelled`/`transferred` are
terminal. Enforced in `StudyUnitsService` via
`ALLOWED_ENROLLMENT_TRANSITIONS`.

### BR-E1's EXCLUDE constraint has no status filter — cancel/finish shrink the range instead
**Judgment call:** BR-E1 as specified is a literal `EXCLUDE USING gist` on
`(student_id, study_unit_id, daterange(...))` with no `WHERE status =
'active'` clause — so a *cancelled* enrollment's date range still
structurally blocks a new overlapping one unless its range is closed.
**Decision:** cancelling or finishing an enrollment always sets `end_date`
to the action date (defaulting to today if the caller didn't supply one)
rather than leaving it at whatever it was — this keeps the exclusion window
bounded going forward instead of blocking every future re-enrollment
indefinitely, while still satisfying BR-E1's literal constraint.

### BR-E3: enrollments are never hard-deleted via the API
**Decision (spec-directed, not actually ambiguous):** there is no `DELETE
/study-units/:id/enrollments/:id` endpoint. "Remove member" in the UI calls
`POST .../cancel` (status=cancelled); a natural end-of-term uses `POST
.../finish` (status=finished). Both are reversible by audit trail, neither
removes the row — lessons/attendance will reference enrollments once T08/T09
exist, and a hard delete would orphan them.

### BR-S3 precedence: `active` > `frozen` > `finished` > `no_enrollment`
**Ambiguity:** the spec says status is "computed from enrollments" but
doesn't give the precedence when a student holds enrollments in different
states across multiple study units simultaneously.
**Decision:** a student with at least one `active` enrollment is `active`,
else at least one `frozen` enrollment makes them `frozen`, else any
enrollment at all (finished/cancelled/transferred-away-with-nothing-active)
makes them `finished`, else `no_enrollment`. `archived` is untouched by this
computation (BR-S3: "stays manual"). Implemented in
`apps/api/src/units/student-status.util.ts`, run inside the same
transaction as every enrollment-status write (CLAUDE.md).

### Study unit name auto-generation
**Judgment call:** the UX mock (docs/design/05-groups.png) shows names like
"B1 Backend" / "Ingliz A2" but doesn't specify the exact composition rule.
**Decision:** `"<Discipline> <Level>"` when a level is set, else just the
discipline name (`autoStudyUnitName` in `study-units.service.ts`). Only
used when the caller leaves `name` blank; an explicit name always wins.

### `study_unit`/`enrollment` permissions added to `administrator`, not to `sales_manager`/`teacher`
**Judgment call:** the task brief asked for a decision on scope here. Groups
and enrollment management (add/remove/transfer/freeze, status changes) is
reception's day-to-day job in this product, the same bucket as
`schedule.*`/`attendance.*` the `administrator` template already holds — so
`study_unit.view/create/update/change_status/manage_members` and
`enrollment.freeze` were added there. `sales_manager` keeps `student.view`
only (no group-management surface — a "my leads" role, not reception).
`teacher` gets neither: a read-only "Guruhlarim" view is more naturally part
of T08/T09's schedule/attendance screens than a standalone grant here.
**Revisit:** once T08/T09 exist, give `teacher` `study_unit.view` scoped to
`own` if a teacher-facing group list is actually built.

### UX 4.3 columns/filters cut for R0: "Dastur bajarilishi %" and "Faqat qarzdorlar bilan"
**Scope note:** both need data that doesn't exist yet — curriculum/program
tracking (no `curriculum_id`, out of scope per the task brief) and finance
(T11 owns debtors). The group list's "Qarzdorlar" column renders a static
`0` for every row with a comment pointing at T11; "Kam toʻldirilgan" (below
min_size) is kept since it's computable today from `capacity`/`min_size`.

### The debtors column and "Kam toʻldirilgan" filter
**Scope note:** `Qarzdorlar` always shows `0` — there is no ledger/payment
data in R0 (T11). `below_min_size` is a real filter, computed in the
service from each study unit's enrolled count vs `min_size` (filtered in
JS after the page is loaded, not in SQL — the enrolled count itself is a
derived aggregate over `enrollments`, and a tenant's study-unit list is
small enough that this is not a performance concern at R0's scale).
