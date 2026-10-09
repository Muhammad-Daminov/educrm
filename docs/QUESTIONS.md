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
