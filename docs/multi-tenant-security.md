# Multi-Tenant Security Model

NeroBooks is a multi-tenant SaaS: many customer organizations ("companies")
share one application and one database. This document describes how the
system keeps those companies isolated from each other, and how that model
is verified.

## The core rule

**`company_id` is never trusted from the client.** Every request that
touches company-owned data goes through this sequence:

1. `requireAuth` verifies the session cookie (a signed JWT containing only
   `userId`, never a company) and re-reads the user's status from the
   database on every request — a deactivated account loses access
   immediately, not at token expiry.
2. `requireCompanyAccess` reads a company id the client is *requesting*
   from the URL (`req.params.companyId`), but treats it as unverified input.
   It queries `company_memberships` for an **active** row linking
   `req.userId` to that company. Only if that row exists does it set
   `req.companyId` — the one value route handlers and database queries are
   allowed to trust — to the now-server-confirmed id.
3. Every company-owned query filters explicitly by `company_id = req.companyId`
   in application code, *and* is independently re-checked by PostgreSQL
   row-level security (below). Two layers have to agree before data moves.

There is no code path anywhere in the server that reads a company id from a
request body, header, or query string and uses it for authorization. A
company id only ever becomes trustworthy by passing step 2.

See [`server/src/auth/middleware.ts`](../server/src/auth/middleware.ts).

## Defense in depth: three independent layers

| Layer | Mechanism | Stops |
|---|---|---|
| Application middleware | `requireCompanyAccess` membership check | Any request for a company the user isn't an active member of |
| Application queries | Explicit `WHERE company_id = $1` on every company-owned table | A bug in RLS wiring, or a query that forgets the middleware ran |
| PostgreSQL row-level security | Policies on every tenant table | A bug in application code that forgets the `WHERE` clause |

Any one of these layers failing alone still leaves the other two standing.
That property is what the automated test suite in
[`server/tests/multi-tenant-security.test.ts`](../server/tests/multi-tenant-security.test.ts)
exists to check.

### Row-level security

Defined in
[`db/migrations/0017_row_level_security.up.sql`](../db/migrations/0017_row_level_security.up.sql).
Two Postgres session variables carry verified identity into the database
itself: `app.current_user_id` and `app.current_company_id`. They are set
exactly once per request, in
[`server/src/db/context.ts`](../server/src/db/context.ts)'s
`withTenantContext()`, via `set_config(name, value, /* is_local */ true)` —
the `true` makes the setting transaction-scoped, so it's automatically
cleared on `COMMIT`/`ROLLBACK` and can never leak into a later request that
reuses the same pooled connection. `withTenantContext` is the *only* place
in the codebase permitted to set these variables — every value it's given
must already have come from server-verified state (a decoded session token
for `userId`, a database-confirmed active membership for `companyId`),
never a client-supplied value taken at face value.

Every company-owned table (`employees`, `payroll_runs`, `invoices`,
`documents`, `customers`, `journal_entries`, and 19 others) has a single
policy: `USING (company_id = current_company) WITH CHECK (company_id =
current_company)`. A handful of tables have a slightly different shape:

- `companies` — visibility follows `company_memberships` directly (not
  `app.current_company_id`), because "list my companies" is inherently a
  cross-company query for one user, and must work without any RLS bypass.
- `company_memberships` / `user_roles` — `SELECT`/`DELETE` allow `user_id =
  current_user OR company_id = current_company` (a user can always see or
  leave their own membership), but `INSERT`/`UPDATE` deliberately allow
  **only** `company_id = current_company` — no "or it's mine" escape hatch.
  Without that asymmetry, a user could `WITH CHECK`-smuggle their own
  membership row into a different company than the one their session
  actually declared.
- Global reference tables (`roles`, `permissions`, `earning_types`, etc.) —
  visible when `company_id IS NULL` (platform-wide defaults) or matches the
  current company; only ever mutable within the current company.
- `users`, `user_profiles`, `permissions` — deliberately **no** RLS. These
  are platform-wide identity/catalog tables, not tenant-owned data.

Two non-obvious bugs surfaced while building this and are worth recording
so they aren't rediscovered the hard way:

1. **`INSERT ... RETURNING` re-checks the `SELECT` policy.** Company
   creation inserts the new `companies` row before any `company_memberships`
   row exists for it — so a `RETURNING` clause on that first `INSERT` fails,
   because Postgres implicitly re-validates the table's `SELECT` policy
   against the row `RETURNING` would hand back, and that policy requires an
   active membership that doesn't exist yet in the same transaction. Fixed
   by not using `RETURNING` on that insert, and selecting the row back only
   after the membership and owner role are created.
2. **A custom GUC "remembers" it was set on a pooled connection.** Once any
   transaction on a given physical connection calls
   `set_config('app.current_company_id', ..., true)`, later transactions on
   that *same reused connection* that never touch the variable again see
   `current_setting(..., true)` return an **empty string**, not `NULL` —
   because the GUC now exists on the backend, just with no current value.
   Casting `''::uuid` throws instead of safely comparing as no-match. Every
   policy that casts a session variable to `uuid` therefore wraps it as
   `nullif(current_setting(...), '')::uuid`.

## Platform administration is a separate axis entirely

`is_platform_admin` (on `users`, added in
[`db/migrations/0016`](../db/migrations/0016_company_profile_and_platform_admin.up.sql))
is never derived from, and never implied by, any `company_memberships` or
`user_roles` row. A company Owner — no matter how privileged inside their
own company — has `is_platform_admin = false` and is denied by
`requirePlatformAdmin` every time. There is no role, permission, or company
setting that can promote a company-scoped user into platform administration;
the flag is set directly on the `users` row, outside any tenant's control.

Platform routes ([`server/src/routes/platform.routes.ts`](../server/src/routes/platform.routes.ts))
additionally connect through a **separate connection pool**
([`server/src/db/platformPool.ts`](../server/src/db/platformPool.ts)) bound
to a distinct Postgres role, `nerobooks_platform_admin`
([`db/migrations/0018`](../db/migrations/0018_platform_admin_role.up.sql)),
created with `BYPASSRLS`. Ordinary company-scoped routes run under
`nerobooks_app`, which has no such bypass. `platformPool` is imported
nowhere outside `platform.routes.ts` — there is exactly one file in the
codebase that can ever see across tenants at the database level, and it is
not reachable by any company-scoped request.

## Storage isolation

Company files live under `<STORAGE_ROOT>/<companyId>/...`
([`server/src/storage/localAdapter.ts`](../server/src/storage/localAdapter.ts)).
Every read/write is scoped to the caller's own `companyId` directory, with
two independent guards: filenames are sanitized (`path.basename` plus a
character whitelist) before being joined into a path, and the resolved
absolute path is checked to still be contained within that company's own
directory before any file operation runs. Even if the document-metadata
lookup that hands a `storage_path` to this layer had a bug, the storage
layer refuses to serve a path outside the caller's own company directory.

## Audit log separation

`audit_logs` is company-scoped like any other tenant table (RLS-enforced,
`company_id` filtered), and every audit entry is written
(`recordAuditEntry`, [`server/src/services/auditService.ts`](../server/src/services/auditService.ts))
using the *same* transaction/client as the request that triggered it — so
the entry is subject to the same tenant context as everything else that
happened in that request, and a company can never see another company's
audit trail.

## What "denied" looks like

Every authorization failure in the system — a malformed company id, a
well-formed id for a company that exists but the user isn't a member of, a
well-formed id for a company that doesn't exist at all, a record id that
belongs to a different company, a suspended membership — returns the exact
same response:

```
403 Access denied.
```

(`{"error": "Access denied."}`, with no other keys.) Resource-not-found
within a company a user *does* belong to returns a similarly generic

```
404 Not found.
```

The point of collapsing all of these into identical, uninformative
responses is that an attacker probing the API cannot use response
differences to map out which company ids or record ids are real. See
`server/src/auth/middleware.ts`'s `denyAccess()` and the `notFound()` helper
in `server/src/routes/resources.routes.ts`.

## Automated verification

[`server/tests/multi-tenant-security.test.ts`](../server/tests/multi-tenant-security.test.ts)
runs the full stack (Express app + real PostgreSQL, via `supertest` against
an in-process `createApp()`) and creates two independent companies with
their own owners, employees, payroll runs, invoices, and uploaded files.
As `18` tests, it attempts, and confirms is denied with the correct generic
response:

- Reading another company's employee list and a specific employee by real id.
- Editing (`PATCH`) another company's payroll run — and confirms the
  target row was genuinely untouched, checked independently from that
  company's own legitimate context.
- Downloading another company's uploaded file.
- Reading another company's invoice.
- Smuggling a foreign `companyId` into a request body field or a custom
  header on an otherwise-legitimate request — confirmed to have zero effect
  either way (the write lands on the caller's own company; the read stays
  scoped to the caller's own company).
- A real employee id belonging to Company B, addressed through Company A's
  own (legitimate) URL — the core IDOR case: the top-level membership check
  passes, and the per-resource `company_id` filter (application query +
  RLS) is what has to catch it. Returns `404`, not `403`, since the caller
  *does* have access to the company named in the URL — there's just no
  such employee inside it.
- A syntactically well-formed but nonexistent company id, and a malformed
  one — both `403`, neither a `500`.
- A random, nonexistent-but-well-formed record id within the caller's own
  company — `404`, indistinguishable from the case above.
- Platform-admin routes reached by a company Owner.
- That suspending a membership revokes API access immediately (checked with
  a real second request after suspension, not just a database-row check).
- That every one of the above denials returns byte-for-byte the same
  response body.

Two "positive control" tests (a user reading their own company's own data
successfully) exist alongside the attacks specifically so that a passing
attack test proves isolation works — not that everything is broken and
therefore denies everything indiscriminately.

Building this test suite surfaced three real bugs that manual smoke-testing
had missed (manual testing had exercised the *denial* paths, which
coincidentally still looked correct, but never fully exercised a legitimate
user successfully reaching their own company's resources through every
route):

1. `requireCompanyAccess`'s own membership lookup ran through the plain,
   unscoped `pool` rather than `withTenantContext` — so it never set
   `app.current_user_id`, and the RLS policy on `company_memberships` (which
   requires that GUC) silently returned zero rows for every request,
   denying legitimate access along with everything else.
2. `resourcesRouter` and `membersRouter` are mounted under a parent path
   with a dynamic segment (`/api/companies/:companyId`), but were created
   with plain `Router()`. Express sub-routers don't inherit a parent
   mount's route params unless created with `Router({ mergeParams: true
   })` — so `req.params.companyId` was empty inside every handler in both
   routers, including inside `requireCompanyAccess` itself.
3. Accepting a company invitation ran its `UPDATE` through
   `withTenantContext({ userId })` with no `companyId` — but the
   `company_memberships` `UPDATE` policy requires `company_id =
   app.current_company_id`, which was never set, so the update silently
   affected zero rows. Fixed by setting the company context to the
   specific company whose invitation is being accepted; the real safety
   boundary in that handler is (and remains) the `WHERE invited_email =
   <this session's own verified email>` clause, not the RLS check, which
   only requires the caller to have truthfully declared which company the
   mutation is scoped to.

Run the suite with `npm test` inside `server/`, against a real, migrated
`nerobooks_test` database (see `server/.env.test`).
