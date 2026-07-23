-- 0008_payroll_lines
--
-- Design note on employee_earnings / employee_deductions / employee_benefits:
--
-- employee_earnings is always transactional: every row belongs to exactly
-- one payroll_entry (payroll_entry_id NOT NULL). Earnings like overtime or a
-- bonus are never a standing "election" — they only ever exist as part of a
-- specific paycheck.
--
-- employee_deductions and employee_benefits are dual-purpose, distinguished
-- by whether payroll_entry_id is set:
--   * payroll_entry_id IS NULL  -> a standing recurring election/enrollment
--     (e.g. "this employee has a standing $50/paycheck 401k deduction").
--     Managed like any other master data; soft-deletable.
--   * payroll_entry_id IS NOT NULL -> the concrete amount actually applied
--     to one specific paycheck (either generated from a template election
--     or a one-off). Immutable once that paycheck is approved/paid, exactly
--     like employee_earnings.
--
-- This is documented in full in docs/database-schema.md.

CREATE TABLE earning_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text NOT NULL,
  is_taxable  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE earning_types IS
  'company_id NULL = global default type (Regular, Overtime, Bonus, ...) available to every company. Soft-deleted so historical employee_earnings rows keep a valid reference after a company deactivates a custom type.';

CREATE UNIQUE INDEX idx_earning_types_global_code ON earning_types (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX idx_earning_types_company_code ON earning_types (company_id, code) WHERE company_id IS NOT NULL;
CREATE INDEX idx_earning_types_company ON earning_types (company_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_earning_types_set_updated_at
  BEFORE UPDATE ON earning_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employee_earnings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  payroll_entry_id uuid NOT NULL REFERENCES payroll_entries (id),
  earning_type_id  uuid NOT NULL REFERENCES earning_types (id),
  hours            numeric(9,2),
  rate             numeric(19,4),
  amount           numeric(19,4) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE employee_earnings IS
  'One earning line (e.g. Regular, Overtime) within a payroll_entry. Always transactional. Immutable once the parent payroll_entry is approved/paid — see trg_employee_earnings_immutable.';

CREATE INDEX idx_employee_earnings_company ON employee_earnings (company_id);
CREATE INDEX idx_employee_earnings_entry ON employee_earnings (payroll_entry_id);
CREATE INDEX idx_employee_earnings_type ON employee_earnings (earning_type_id);

CREATE TRIGGER trg_employee_earnings_set_updated_at
  BEFORE UPDATE ON employee_earnings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_payroll_line_immutable_via_entry(entry_id uuid) RETURNS boolean AS $$
  SELECT status IN ('approved', 'paid') FROM payroll_entries WHERE id = entry_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION check_payroll_line_immutable_via_entry(uuid) IS
  'Shared helper: true if the given payroll_entry is locked (approved/paid). Used by the earnings/deductions/benefits line-item immutability triggers.';

CREATE FUNCTION check_employee_earnings_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
      RAISE EXCEPTION 'employee_earnings %: parent paycheck is locked; cannot delete.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
    RAISE EXCEPTION 'employee_earnings %: parent paycheck is locked; cannot modify.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employee_earnings_immutable
  BEFORE UPDATE OR DELETE ON employee_earnings
  FOR EACH ROW EXECUTE FUNCTION check_employee_earnings_immutable();

CREATE TABLE deduction_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies (id) ON DELETE CASCADE,
  name                text NOT NULL,
  code                text NOT NULL,
  deduction_category  text NOT NULL DEFAULT 'other'
                         CHECK (deduction_category IN ('pretax', 'posttax', 'tax', 'garnishment', 'other')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

COMMENT ON TABLE deduction_types IS
  'Same global-vs-company-scoped pattern as earning_types (e.g. Health Insurance, 401k, Garnishment).';

CREATE UNIQUE INDEX idx_deduction_types_global_code ON deduction_types (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX idx_deduction_types_company_code ON deduction_types (company_id, code) WHERE company_id IS NOT NULL;
CREATE INDEX idx_deduction_types_company ON deduction_types (company_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_deduction_types_set_updated_at
  BEFORE UPDATE ON deduction_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employee_deductions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  deduction_type_id uuid NOT NULL REFERENCES deduction_types (id),
  payroll_entry_id  uuid REFERENCES payroll_entries (id),
  amount            numeric(19,4),
  percent           numeric(6,3),
  start_date        date,
  end_date          date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (amount IS NOT NULL OR percent IS NOT NULL),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE employee_deductions IS
  'payroll_entry_id NULL = standing recurring election (template). payroll_entry_id NOT NULL = the concrete amount applied to that one paycheck. Templates are soft-deletable at any time; applied instances become immutable once their paycheck is approved/paid — see trg_employee_deductions_immutable.';

CREATE INDEX idx_employee_deductions_company ON employee_deductions (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_deductions_employee
  ON employee_deductions (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_deductions_entry ON employee_deductions (payroll_entry_id);
CREATE INDEX idx_employee_deductions_type ON employee_deductions (deduction_type_id);

CREATE TRIGGER trg_employee_deductions_set_updated_at
  BEFORE UPDATE ON employee_deductions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_employee_deductions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payroll_entry_id IS NOT NULL AND check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
      RAISE EXCEPTION 'employee_deductions %: parent paycheck is locked; cannot delete.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.payroll_entry_id IS NOT NULL AND check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
    RAISE EXCEPTION 'employee_deductions %: parent paycheck is locked; cannot modify.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employee_deductions_immutable
  BEFORE UPDATE OR DELETE ON employee_deductions
  FOR EACH ROW EXECUTE FUNCTION check_employee_deductions_immutable();

CREATE TABLE benefit_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid REFERENCES companies (id) ON DELETE CASCADE,
  name              text NOT NULL,
  code              text NOT NULL,
  is_employer_paid  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

COMMENT ON TABLE benefit_types IS
  'Same global-vs-company-scoped pattern as earning_types (e.g. Health, Dental, Vision, 401k Match).';

CREATE UNIQUE INDEX idx_benefit_types_global_code ON benefit_types (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX idx_benefit_types_company_code ON benefit_types (company_id, code) WHERE company_id IS NOT NULL;
CREATE INDEX idx_benefit_types_company ON benefit_types (company_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_benefit_types_set_updated_at
  BEFORE UPDATE ON benefit_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employee_benefits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  benefit_type_id        uuid NOT NULL REFERENCES benefit_types (id),
  payroll_entry_id       uuid REFERENCES payroll_entries (id),
  employee_contribution  numeric(19,4) NOT NULL DEFAULT 0,
  employer_contribution  numeric(19,4) NOT NULL DEFAULT 0,
  start_date             date,
  end_date               date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE employee_benefits IS
  'Same template-vs-instance pattern as employee_deductions (payroll_entry_id NULL = standing enrollment, NOT NULL = applied instance for one paycheck).';

CREATE INDEX idx_employee_benefits_company ON employee_benefits (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_benefits_employee
  ON employee_benefits (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_benefits_entry ON employee_benefits (payroll_entry_id);
CREATE INDEX idx_employee_benefits_type ON employee_benefits (benefit_type_id);

CREATE TRIGGER trg_employee_benefits_set_updated_at
  BEFORE UPDATE ON employee_benefits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_employee_benefits_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payroll_entry_id IS NOT NULL AND check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
      RAISE EXCEPTION 'employee_benefits %: parent paycheck is locked; cannot delete.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.payroll_entry_id IS NOT NULL AND check_payroll_line_immutable_via_entry(OLD.payroll_entry_id) THEN
    RAISE EXCEPTION 'employee_benefits %: parent paycheck is locked; cannot modify.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employee_benefits_immutable
  BEFORE UPDATE OR DELETE ON employee_benefits
  FOR EACH ROW EXECUTE FUNCTION check_employee_benefits_immutable();
