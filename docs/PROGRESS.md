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
