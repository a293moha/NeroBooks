-- 0016_company_profile_and_platform_admin
--
-- Extends companies/company_settings with the full profile fields needed by
-- the company-account feature (trading name, address, country, tax
-- identifiers, logo, payroll/accounting settings), and adds the platform
-- administrator flag used to keep platform-level administration completely
-- separate from any company-scoped role (see docs/multi-tenant-security.md).
--
-- 0001-0015 are already shipped; this is an additive migration, not an edit
-- to any of them.

ALTER TABLE companies
  ADD COLUMN trading_name    text,
  ADD COLUMN logo_document_id uuid REFERENCES documents (id) ON DELETE SET NULL,
  ADD COLUMN address_line1   text,
  ADD COLUMN address_line2   text,
  ADD COLUMN city            text,
  ADD COLUMN state_province  text,
  ADD COLUMN postal_code     text,
  ADD COLUMN country_code    char(2) CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN tax_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN companies.trading_name IS
  'The "doing business as" name shown in the product UI. legal_name is what appears on tax/legal documents; name (from 0002) is the internal/display label used throughout the schema''s existing foreign keys and is treated as a synonym of trading_name going forward — the application should keep them in sync.';
COMMENT ON COLUMN companies.logo_document_id IS
  'References a row in documents (owner_type = ''company_logo'', owner_id = companies.id) holding the actual file metadata. Nullable: a company may have no logo.';
COMMENT ON COLUMN companies.tax_identifiers IS
  'Flexible map of tax identifier type -> value, e.g. {"ein": "12-3456789", "vat": "GB123456789"} — different countries use different identifier schemes, so this is intentionally not a fixed set of columns. tax_id (0002) remains as the single "primary" identifier for backward compatibility with existing code that reads it.';

CREATE INDEX idx_companies_country ON companies (country_code) WHERE deleted_at IS NULL;

ALTER TABLE company_settings
  ADD COLUMN payroll_settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN accounting_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN company_settings.payroll_settings IS
  'Payroll configuration beyond the already-typed default_pay_frequency column — e.g. overtime rules, default earning/deduction type IDs, approval requirements. Promote a key to a real column once it needs to be queried or validated at the database level.';
COMMENT ON COLUMN company_settings.accounting_settings IS
  'Accounting configuration — e.g. default chart-of-accounts template, fiscal year rollover behavior, journal approval requirements. Same promotion rule as payroll_settings.';

-- Platform administration is a completely separate concept from any
-- company-scoped role (Owner, Admin, etc. — see 0004). A user with this
-- flag can access platform-only routes (e.g. suspending any company); a
-- company Owner/Admin, no matter how privileged within their own company,
-- can never set or inherit this flag through any company-scoped action.
ALTER TABLE users
  ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_platform_admin IS
  'Platform-level administrator flag, orthogonal to company_memberships/user_roles. Must only ever be set by a trusted out-of-band process (direct database access, or a dedicated platform-admin-only route that itself requires an existing platform admin) — never derivable from, or settable via, any company-scoped API.';
