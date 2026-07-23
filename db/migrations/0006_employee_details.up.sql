-- 0006_employee_details
--
-- company_id is denormalized onto every table below even though it is also
-- derivable via employee_id -> employees.company_id. This mirrors the same
-- choice made for payroll_entries, payments, and bank_transactions
-- elsewhere in this schema: every company-owned table carries company_id
-- directly, both per the project's explicit requirement and because it lets
-- every query and every future row-level-security policy filter on one
-- column instead of a join.

CREATE TABLE employee_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  address_type  text NOT NULL DEFAULT 'home' CHECK (address_type IN ('home', 'mailing')),
  line1         text NOT NULL,
  line2         text,
  city          text NOT NULL,
  state_province text,
  postal_code   text,
  country_code  char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, address_type)
);

COMMENT ON TABLE employee_addresses IS
  'At most one home and one mailing address per employee. Hard-deletable (no deleted_at): superseded by simply updating in place; no downstream table references a specific address row.';

CREATE INDEX idx_employee_addresses_company ON employee_addresses (company_id);
CREATE INDEX idx_employee_addresses_employee ON employee_addresses (employee_id);

CREATE TRIGGER trg_employee_addresses_set_updated_at
  BEFORE UPDATE ON employee_addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employee_bank_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  bank_name                 text NOT NULL,
  account_holder_name       text NOT NULL,
  account_number_encrypted  text NOT NULL,
  account_number_last4      char(4) NOT NULL,
  routing_number_encrypted  text NOT NULL,
  account_type              text NOT NULL DEFAULT 'checking'
                               CHECK (account_type IN ('checking', 'savings')),
  is_primary                boolean NOT NULL DEFAULT true,
  verified_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);

COMMENT ON TABLE employee_bank_accounts IS
  'Soft-deleted only: a past payroll_entry may reference exactly which bank account a historical payment went to (see payroll_entries.bank_account_id), even after the employee changes or removes it.';
COMMENT ON COLUMN employee_bank_accounts.account_number_encrypted IS
  'Ciphertext produced by the application''s encryption service (e.g. pgcrypto pgp_sym_encrypt with a key that is NEVER stored in this database, or envelope encryption via an external KMS). Postgres itself does not encrypt this column automatically.';
COMMENT ON COLUMN employee_bank_accounts.account_number_last4 IS
  'Plaintext last 4 digits only, kept for UI display ("...1234") without ever decrypting the full number for that purpose.';

CREATE INDEX idx_employee_bank_accounts_company ON employee_bank_accounts (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_bank_accounts_employee
  ON employee_bank_accounts (employee_id) WHERE deleted_at IS NULL;
-- At most one primary account per employee among the non-deleted rows.
CREATE UNIQUE INDEX idx_employee_bank_accounts_one_primary
  ON employee_bank_accounts (employee_id) WHERE is_primary AND deleted_at IS NULL;

CREATE TRIGGER trg_employee_bank_accounts_set_updated_at
  BEFORE UPDATE ON employee_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- employee_tax_profiles and employment_records are both append-only,
-- time-sliced history: a "change" is a new row with a later effective_date,
-- never an edit of a past row. This matches how real payroll systems must
-- behave — you cannot rewrite what someone's withholding elections were on
-- a date in the past. Enforced with the same prevent_update_delete() guard
-- used for audit_logs (0001), applied unconditionally here (not just after
-- approval) because these rows should never change from the moment they
-- exist, full stop.

CREATE TABLE employee_tax_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  effective_date        date NOT NULL,
  tax_country_code      char(2) NOT NULL DEFAULT 'US' CHECK (tax_country_code ~ '^[A-Z]{2}$'),
  filing_status         text,
  federal_allowances    integer,
  additional_withholding numeric(19,4) NOT NULL DEFAULT 0,
  state_code            text,
  tax_id_encrypted      text,
  tax_id_last4          char(4),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_date)
);

COMMENT ON TABLE employee_tax_profiles IS
  'Append-only, time-sliced tax election history. The "current" profile for a given date is the row with the latest effective_date <= that date. Corrections are new rows with a corrected effective_date, never edits — see trg_employee_tax_profiles_immutable.';
COMMENT ON COLUMN employee_tax_profiles.tax_id_encrypted IS
  'Ciphertext for a national tax id (SSN/SIN/etc.), same encryption approach as employee_bank_accounts.account_number_encrypted. Never store this in plaintext.';

CREATE INDEX idx_employee_tax_profiles_company ON employee_tax_profiles (company_id);
CREATE INDEX idx_employee_tax_profiles_employee_date
  ON employee_tax_profiles (employee_id, effective_date DESC);

CREATE TRIGGER trg_employee_tax_profiles_immutable
  BEFORE UPDATE OR DELETE ON employee_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TABLE employment_records (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  effective_date            date NOT NULL,
  job_title                 text,
  department_id             uuid REFERENCES departments (id),
  employment_type           text NOT NULL DEFAULT 'full_time'
                               CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern')),
  pay_type                  text NOT NULL CHECK (pay_type IN ('salary', 'hourly')),
  pay_rate                  numeric(19,4) NOT NULL CHECK (pay_rate >= 0),
  pay_currency               char(3) NOT NULL DEFAULT 'USD' CHECK (pay_currency ~ '^[A-Z]{3}$'),
  standard_hours_per_week   numeric(5,2),
  reason                    text,
  created_by                uuid REFERENCES users (id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_date)
);

COMMENT ON TABLE employment_records IS
  'Append-only compensation/job history (hires, promotions, pay changes, transfers). The employee''s current job_title/pay_rate/department is whichever row has the latest effective_date <= today. Never edited after creation — see trg_employment_records_immutable.';
COMMENT ON COLUMN employment_records.pay_rate IS
  'Annual salary if pay_type = salary, hourly rate if pay_type = hourly.';

CREATE INDEX idx_employment_records_company ON employment_records (company_id);
CREATE INDEX idx_employment_records_employee_date
  ON employment_records (employee_id, effective_date DESC);
CREATE INDEX idx_employment_records_department ON employment_records (department_id);

CREATE TRIGGER trg_employment_records_immutable
  BEFORE UPDATE OR DELETE ON employment_records
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
