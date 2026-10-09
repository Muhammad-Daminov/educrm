Step 0.3 of EduCRM: authentication + RBAC. Read TZ sections 3, 6.1, 6.5, 8.3 first.
Scope note (R0): 2FA, OTP and parent portal auth are OUT of scope for now.

A. Data (each tenant table with ENABLE/FORCE RLS + USING/WITH CHECK, like branches):
   users, sessions, roles, role_permissions(role_id, permission_code, scope own|branch|all),
   user_roles, user_branches. permissions(code, description) is global (no RLS).
   Seed the full permission catalog from TZ 3.2 and system role templates:
   owner, branch_manager, administrator, accountant, teacher, sales_manager.

B. Login without knowing tenant in advance:
   - Login body: { tenant_slug, login (phone or email), password }.
     Web reads tenant_slug from env DEFAULT_TENANT_SLUG for now.
   - Lookup via a SECURITY DEFINER SQL function auth_find_user(slug, login) owned by
     migrator, returning only (user_id, tenant_id, password_hash, is_active).
     EXECUTE granted to app_user. This is the ONLY RLS bypass; document it.
   - Phone normalized to +998XXXXXXXXX (libphonenumber-js).

C. Tokens and sessions:
   - Argon2id password hashing (min 10 chars).
   - Access JWT 15 min (claims: sub, tenant_id, session_id), refresh token 30 days,
     opaque random, stored as SHA-256 hash in sessions with family_id.
   - Refresh rotation + reuse detection: reusing an old refresh token revokes the whole family.
   - Both tokens in httpOnly, Secure (except local dev), SameSite=Lax cookies.
     Refresh cookie path-scoped to /api/v1/auth.
   - CSRF: double-submit token (non-httpOnly cookie + X-CSRF-Token header) required on
     all non-GET requests.
   - Next.js rewrites /api/* to the API so the browser sees one origin (no CORS).
   - Deactivating a user revokes all sessions.

D. Tenant context: remove the X-Tenant-Id resolver completely. tenant_id now comes ONLY
   from the verified access token. Update all tests.

E. Authorization:
   - Global guard, default DENY. Every route needs @RequirePermission('res.action')
     or @Public().
   - Permission check loads the user's effective permissions (cache in Redis 60s,
     invalidate on role change).
   - Expose scope + allowed_branch_ids on the request context for later branch scoping.
   - CI check: a script that scans all controllers; any route without
     @RequirePermission or @Public fails `pnpm lint`.

F. Endpoints: POST /auth/login, /auth/refresh, /auth/logout, GET /auth/me
   (user, roles, permissions, branches), POST /auth/logout-all.
   Protect existing /branches with branch.view / branch.create.

G. Rate limit (Redis): login 5 attempts / 15 min per IP and per account → 429.
   After 5 failed attempts on an account, lock it for 15 min.

H. CLI: pnpm --filter api seed:owner --tenant <slug> --name ... --phone ... --password ...
   (creates tenant if missing, owner user with owner role).

I. Web: /login page (phone/email + password, uz texts via i18n keys), protected app
   layout that redirects to /login, header with user name + logout, a page showing /auth/me.
   Silent refresh on 401 once, then redirect to login.

Tests (must pass):
- login success / wrong password / inactive user / unknown tenant (same generic error)
- refresh rotation; reused refresh token → whole family revoked
- deactivated user cannot refresh
- route without permission → 403; unauthenticated → 401
- token from tenant A cannot read tenant B data
- non-GET without CSRF header → 403
- login rate limit → 429
- lint fails when a test controller route has no decorator (prove the CI check works)

Acceptance: show test output, curl login → me → logout flow, screenshot-free description
of the web login working, lint/typecheck clean. Then STOP.
