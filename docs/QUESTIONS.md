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

### Uzbek apostrophes are ASCII, not the proper modifier letters
**Contradiction:** UX §8 requires "Lotin yozuvi, o' va g' to'g'ri belgilar
bilan" — the real characters in `oʻ`/`gʻ`. Everything shipped so far
(`lib/i18n.ts`, `Money.format()`'s `so'm` suffix) uses the ASCII `'`.
**Decision (deferred, not skipped):** stay ASCII for now, consistently,
rather than mix the two. Switching needs one decision — U+02BB MODIFIER
LETTER TURNED COMMA (orthographically correct) vs U+2019 RIGHT SINGLE
QUOTATION MARK (what the spec PDF itself appears to use) — and then it is
`apps/web/lib/i18n.ts` plus `CURRENCY_SUFFIX` in `packages/shared/src/
money.ts`. The command palette already normalizes every apostrophe variant
away before matching, so search cannot break either way.
**Revisit:** before any customer-facing release — it is a correctness
issue in the language, not a style preference.

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

### audit_log partitions run out in 2029-10
**Scope note:** the migration pre-creates 36 monthly partitions and
deliberately creates no DEFAULT partition — emptying one later needs a
DELETE, which the append-only trigger correctly refuses, so a missing month
has to fail loudly instead of silently absorbing rows.
`ensure_audit_log_partition(date)` is the idempotent maintenance entry
point; it must be called (as `migrator` — it is DDL) on a schedule before
the runway ends. No scheduler owns it yet.
**Revisit:** T12 (deployment), or sooner if an ops cron lands first.

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
