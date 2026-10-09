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
