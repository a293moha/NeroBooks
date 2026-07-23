-- 0017_row_level_security
--
-- Database-level, defense-in-depth tenant isolation on top of the
-- application-layer checks in server/. Even a bug in the application code
-- that forgets a `WHERE company_id = ...` clause cannot leak another
-- company's rows, because Postgres itself refuses to return them.
--
-- Two session variables, set by the application on every request (never by
-- the client, never trusted from a request body/header/query string):
--
--   app.current_user_id     — the authenticated user, from a verified
--                              session token. Set on every authenticated
--                              request.
--   app.current_company_id  — the company the request has been verified to
--                              act within (see server/src/auth/middleware.ts
--                              requireCompanyAccess). Set only after the
--                              server has independently confirmed an active
--                              company_memberships row for that
--                              (user, company) pair — never set from a
--                              client-supplied value directly.
--
-- Both are read with current_setting(..., true) (missing_ok = true) AND
-- wrapped in nullif(..., '') before any ::uuid cast. The missing_ok flag
-- alone is not enough: on a pooled connection, once a custom GUC has been
-- set via SET LOCAL / set_config(..., true) in ANY earlier transaction on
-- that same physical connection, later transactions that never touch it
-- again see it reset to an empty string — not NULL — once that GUC has
-- been "seen" by the backend at all. An empty string fed straight into
-- ::uuid throws invalid_text_representation instead of comparing as
-- "no match," which would otherwise turn a request that should see
-- nothing into a 500 error. nullif(current_setting(...), '') converts that
-- empty string to a true NULL first, so the safe failure mode stays
-- "see nothing," not "crash" — and, worse, not "see everything." This was
-- caught by hand-testing this migration against pg's actual connection
-- pooling behavior, not by inspection — see docs/multi-tenant-security.md.
--
-- The migration-running role (postgres, a superuser) always bypasses RLS,
-- so none of this affects migrations or the seed scripts. It only takes
-- effect for connections made as the restricted `nerobooks_app` role
-- (0015) that the actual backend server uses.
--
-- Postgres CREATE POLICY does not accept a comma-separated command list
-- (`FOR SELECT, UPDATE` is invalid syntax) — every command that needs
-- different behavior gets its own policy statement below.

-- ---------- Companies (identity is the tenant itself) ----------
-- Visibility follows company_memberships directly, not
-- app.current_company_id, so that "list my companies" — which is
-- inherently a cross-company query for one user — works without any RLS
-- bypass: a user sees every company where they hold an active membership.
-- Creating a brand new company is allowed for any authenticated user
-- (that is the "Company creation" feature, and it can never cross into an
-- existing tenant), so INSERT has its own unrestricted-by-membership check.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select ON companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        AND cm.status = 'active'
    )
  );

CREATE POLICY companies_insert ON companies
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_user_id', true), '') IS NOT NULL);

CREATE POLICY companies_update ON companies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        AND cm.status = 'active'
    )
  );

CREATE POLICY companies_delete ON companies
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM company_memberships cm
      WHERE cm.company_id = companies.id
        AND cm.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        AND cm.status = 'active'
    )
  );

-- ---------- company_memberships ----------
-- SELECT/DELETE: a user can always see or remove (leave) their own
-- membership rows regardless of which company context is active, and can
-- see every membership row for whichever company they're currently acting
-- within (to manage the team).
-- INSERT/UPDATE: deliberately do NOT allow the "or it's mine" escape hatch
-- that SELECT/DELETE have — otherwise a user could UPDATE a membership row
-- they own in company B while their session context is company A and,
-- because WITH CHECK is evaluated against the *new* row, potentially
-- rewrite it into company A. Mutations are only ever allowed strictly
-- within the currently-authorized company context.
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_memberships_select ON company_memberships
  FOR SELECT
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

CREATE POLICY company_memberships_insert ON company_memberships
  FOR INSERT
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY company_memberships_update ON company_memberships
  FOR UPDATE
  USING (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY company_memberships_delete ON company_memberships
  FOR DELETE
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

-- ---------- user_roles (same shape as company_memberships) ----------
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select ON user_roles
  FOR SELECT
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

CREATE POLICY user_roles_insert ON user_roles
  FOR INSERT
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY user_roles_update ON user_roles
  FOR UPDATE
  USING (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY user_roles_delete ON user_roles
  FOR DELETE
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

-- ---------- roles (global-or-company-scoped) ----------
-- Global rows (company_id IS NULL) are visible to everyone; a tenant
-- session may only ever write rows scoped to its own company_id, never a
-- global row and never an update/delete of an existing global row — global
-- roles are seeded by the migration/seed process running as the table
-- owner, which bypasses RLS entirely.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY roles_select ON roles
  FOR SELECT
  USING (
    company_id IS NULL
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

CREATE POLICY roles_insert ON roles
  FOR INSERT
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY roles_update ON roles
  FOR UPDATE
  USING (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

CREATE POLICY roles_delete ON roles
  FOR DELETE
  USING (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);

-- ---------- role_permissions (no company_id of its own; inherits from roles) ----------
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_isolation ON role_permissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
        AND (r.company_id IS NULL
             OR r.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid)
    )
  );

-- ---------- Global-or-company-scoped reference tables ----------
-- Same shape as roles: global default types visible to everyone, but a
-- tenant session can only write (insert/update/delete) its own
-- company-scoped custom types, never a global one.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'earning_types', 'deduction_types', 'benefit_types', 'expense_categories',
    'audit_logs', 'notifications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (company_id IS NULL OR company_id = current_setting(''app.current_company_id'', true)::uuid)',
      t || '_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (company_id = current_setting(''app.current_company_id'', true)::uuid)',
      t || '_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (company_id = current_setting(''app.current_company_id'', true)::uuid) WITH CHECK (company_id = current_setting(''app.current_company_id'', true)::uuid)',
      t || '_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (company_id = current_setting(''app.current_company_id'', true)::uuid)',
      t || '_delete', t
    );
  END LOOP;
END $$;

-- ---------- Standard company-owned tables (company_id NOT NULL) ----------
-- The bulk of the schema: one straightforward policy per table, covering
-- every command identically, since there is no global-vs-scoped
-- distinction to make for any of these. A tenant session may only see and
-- write rows whose company_id matches the currently-authorized company
-- context.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_settings', 'departments', 'employees', 'employee_addresses',
    'employee_bank_accounts', 'employee_tax_profiles', 'employment_records',
    'payroll_periods', 'payroll_runs', 'payroll_entries', 'employee_earnings',
    'employee_deductions', 'employee_benefits', 'customers', 'vendors',
    'invoices', 'invoice_items', 'payments', 'expenses', 'chart_of_accounts',
    'journal_entries', 'journal_entry_lines', 'bank_accounts',
    'bank_transactions', 'documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (company_id = current_setting(''app.current_company_id'', true)::uuid) WITH CHECK (company_id = current_setting(''app.current_company_id'', true)::uuid)',
      t || '_isolation', t
    );
  END LOOP;
END $$;

-- ---------- Deliberately NOT given tenant-scoped RLS ----------
-- users, user_profiles: platform-wide identity with no company_id at all
--   (see docs/database-schema.md "Deliberate exceptions to company_id").
--   The application only ever exposes user data in the context of an
--   already-tenant-scoped membership/employee list, so this is enforced
--   at the application layer rather than via a same-table RLS policy here.
--   See docs/multi-tenant-security.md for the full reasoning.
-- permissions: a global, read-only system catalog with no tenant
--   dimension whatsoever — there is nothing to isolate.
