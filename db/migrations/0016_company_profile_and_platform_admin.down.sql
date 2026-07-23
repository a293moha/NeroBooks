-- Rollback for 0016_company_profile_and_platform_admin
ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin;

ALTER TABLE company_settings
  DROP COLUMN IF EXISTS accounting_settings,
  DROP COLUMN IF EXISTS payroll_settings;

DROP INDEX IF EXISTS idx_companies_country;

ALTER TABLE companies
  DROP COLUMN IF EXISTS tax_identifiers,
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS state_province,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS logo_document_id,
  DROP COLUMN IF EXISTS trading_name;
