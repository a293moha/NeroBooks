-- 0007_payroll_core

CREATE TABLE payroll_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  pay_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'processing', 'closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

COMMENT ON TABLE payroll_periods IS
  'A pay-period window (e.g. Jul 1-15) shared by all payroll_runs generated for it.';

CREATE INDEX idx_payroll_periods_company ON payroll_periods (company_id);
CREATE INDEX idx_payroll_periods_pay_date ON payroll_periods (company_id, pay_date);

CREATE TRIGGER trg_payroll_periods_set_updated_at
  BEFORE UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payroll_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  payroll_period_id    uuid NOT NULL REFERENCES payroll_periods (id),
  run_type             text NOT NULL DEFAULT 'regular'
                          CHECK (run_type IN ('regular', 'off_cycle', 'correction', 'bonus')),
  status               text NOT NULL DEFAULT 'draft'
                          CHECK (status IN
                            ('draft', 'calculating', 'pending_approval', 'approved', 'paid', 'cancelled')),
  total_gross          numeric(19,4) NOT NULL DEFAULT 0,
  total_deductions     numeric(19,4) NOT NULL DEFAULT 0,
  total_net            numeric(19,4) NOT NULL DEFAULT 0,
  total_employer_cost  numeric(19,4) NOT NULL DEFAULT 0,
  approved_by          uuid REFERENCES users (id),
  approved_at          timestamptz,
  paid_at              timestamptz,
  created_by           uuid REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE payroll_runs IS
  'One payroll run (a batch of paychecks for one period). MUST NOT be editable or deletable once approved or paid — see trg_payroll_runs_immutable. Corrections after approval require a new run with run_type = correction, never editing this row.';

CREATE INDEX idx_payroll_runs_company ON payroll_runs (company_id);
CREATE INDEX idx_payroll_runs_period ON payroll_runs (payroll_period_id);
CREATE INDEX idx_payroll_runs_status ON payroll_runs (company_id, status);

CREATE TRIGGER trg_payroll_runs_set_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_payroll_run_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION
        'payroll_runs %: cannot delete a run with status %. Use a correction run instead.',
        OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION
      'payroll_runs %: this run is paid and fully locked. Corrections require a new run.', OLD.id;
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.company_id          IS DISTINCT FROM OLD.company_id
       OR NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
       OR NEW.total_gross        IS DISTINCT FROM OLD.total_gross
       OR NEW.total_deductions   IS DISTINCT FROM OLD.total_deductions
       OR NEW.total_net          IS DISTINCT FROM OLD.total_net
       OR NEW.total_employer_cost IS DISTINCT FROM OLD.total_employer_cost
       OR NEW.created_by         IS DISTINCT FROM OLD.created_by
       OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'payroll_runs %: financial totals are locked once approved. Only status/paid_at may change.', OLD.id;
    END IF;

    IF NEW.status NOT IN ('approved', 'paid', 'cancelled') THEN
      RAISE EXCEPTION
        'payroll_runs %: an approved run can only move to paid or cancelled.', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_runs_immutable
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION check_payroll_run_immutable();

CREATE TABLE payroll_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  payroll_run_id    uuid NOT NULL REFERENCES payroll_runs (id),
  employee_id       uuid NOT NULL REFERENCES employees (id),
  gross_pay         numeric(19,4) NOT NULL DEFAULT 0,
  total_earnings    numeric(19,4) NOT NULL DEFAULT 0,
  total_deductions  numeric(19,4) NOT NULL DEFAULT 0,
  total_taxes       numeric(19,4) NOT NULL DEFAULT 0,
  net_pay           numeric(19,4) NOT NULL DEFAULT 0,
  employer_tax_cost numeric(19,4) NOT NULL DEFAULT 0,
  bank_account_id   uuid REFERENCES employee_bank_accounts (id),
  payment_method    text NOT NULL DEFAULT 'direct_deposit'
                       CHECK (payment_method IN ('direct_deposit', 'check', 'cash')),
  status            text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'paid', 'void')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

COMMENT ON TABLE payroll_entries IS
  'One employee''s paycheck within a payroll_run. bank_account_id is a point-in-time snapshot of which account was paid, preserved even if the employee later changes their bank details. Immutable once approved/paid — see trg_payroll_entries_immutable.';

CREATE INDEX idx_payroll_entries_company ON payroll_entries (company_id);
CREATE INDEX idx_payroll_entries_run ON payroll_entries (payroll_run_id);
CREATE INDEX idx_payroll_entries_employee ON payroll_entries (employee_id);
CREATE INDEX idx_payroll_entries_bank_account ON payroll_entries (bank_account_id);

CREATE TRIGGER trg_payroll_entries_set_updated_at
  BEFORE UPDATE ON payroll_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_payroll_entry_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION
        'payroll_entries %: cannot delete an entry with status %. Use a correction run instead.',
        OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'payroll_entries %: this entry is paid and fully locked.', OLD.id;
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.gross_pay          IS DISTINCT FROM OLD.gross_pay
       OR NEW.total_earnings   IS DISTINCT FROM OLD.total_earnings
       OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
       OR NEW.total_taxes      IS DISTINCT FROM OLD.total_taxes
       OR NEW.net_pay          IS DISTINCT FROM OLD.net_pay
       OR NEW.employer_tax_cost IS DISTINCT FROM OLD.employer_tax_cost
       OR NEW.employee_id      IS DISTINCT FROM OLD.employee_id
       OR NEW.payroll_run_id   IS DISTINCT FROM OLD.payroll_run_id
       OR NEW.bank_account_id  IS DISTINCT FROM OLD.bank_account_id
    THEN
      RAISE EXCEPTION
        'payroll_entries %: financial fields are locked once approved. Only status may change.', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_entries_immutable
  BEFORE UPDATE OR DELETE ON payroll_entries
  FOR EACH ROW EXECUTE FUNCTION check_payroll_entry_immutable();
