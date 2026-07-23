-- 0002_companies
-- The tenant root. Every company-owned table elsewhere carries a company_id
-- foreign key back to this table.

CREATE TABLE companies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  legal_name               text,
  tax_id                   text,
  default_currency         char(3) NOT NULL DEFAULT 'USD'
                             CHECK (default_currency ~ '^[A-Z]{3}$'),
  timezone                 text NOT NULL DEFAULT 'UTC',
  fiscal_year_start_month  smallint NOT NULL DEFAULT 1
                             CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended', 'closed')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

COMMENT ON TABLE companies IS
  'One row per tenant (client company). Root of all multi-tenant scoping.';
COMMENT ON COLUMN companies.deleted_at IS
  'Soft delete: a closed/offboarded company''s historical records must remain queryable for legal/financial retention. Never hard-delete.';

CREATE INDEX idx_companies_status ON companies (status) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_companies_set_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One-to-one operational settings, split out of `companies` so that
-- frequently-changing preferences don't churn the tenant root row.
CREATE TABLE company_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL UNIQUE
                                REFERENCES companies (id) ON DELETE CASCADE,
  invoice_number_prefix       text NOT NULL DEFAULT 'INV-',
  next_invoice_sequence       integer NOT NULL DEFAULT 1
                                CHECK (next_invoice_sequence > 0),
  default_payment_terms_days  integer NOT NULL DEFAULT 30
                                CHECK (default_payment_terms_days >= 0),
  default_pay_frequency       text NOT NULL DEFAULT 'monthly'
                                CHECK (default_pay_frequency IN
                                  ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  extra                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_settings IS
  '1:1 operational settings per company. "extra" is an escape hatch for future settings that do not yet warrant their own column.';
COMMENT ON COLUMN company_settings.next_invoice_sequence IS
  'Next number to assign when generating an invoice number; incremented by the application inside the same transaction that creates the invoice.';

CREATE TRIGGER trg_company_settings_set_updated_at
  BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
