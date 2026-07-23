-- 0011_expenses

CREATE TABLE expense_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE expense_categories IS
  'Same global-vs-company-scoped pattern as earning_types/deduction_types/benefit_types.';

CREATE UNIQUE INDEX idx_expense_categories_global_name ON expense_categories (name) WHERE company_id IS NULL;
CREATE UNIQUE INDEX idx_expense_categories_company_name ON expense_categories (company_id, name) WHERE company_id IS NOT NULL;
CREATE INDEX idx_expense_categories_company ON expense_categories (company_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_expense_categories_set_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  vendor_id            uuid REFERENCES vendors (id),
  expense_category_id  uuid NOT NULL REFERENCES expense_categories (id),
  date                 date NOT NULL,
  amount               numeric(19,4) NOT NULL CHECK (amount >= 0),
  currency             char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  memo                 text,
  payment_method       text NOT NULL DEFAULT 'credit_card'
                          CHECK (payment_method IN
                            ('credit_card', 'debit_card', 'bank_transfer', 'cash', 'check', 'other')),
  status               text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'reimbursed', 'rejected')),
  submitted_by         uuid REFERENCES users (id),
  approved_by          uuid REFERENCES users (id),
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

COMMENT ON TABLE expenses IS
  'Deletable/editable while pending; locked once approved/reimbursed/rejected — see trg_expenses_immutable.';

CREATE INDEX idx_expenses_company ON expenses (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_vendor ON expenses (vendor_id);
CREATE INDEX idx_expenses_category ON expenses (expense_category_id);
CREATE INDEX idx_expenses_status ON expenses (company_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_expenses_set_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_expenses_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'expenses %: only a pending expense can be deleted (status is %).', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'pending' THEN
    IF NEW.amount        IS DISTINCT FROM OLD.amount
       OR NEW.currency      IS DISTINCT FROM OLD.currency
       OR NEW.vendor_id     IS DISTINCT FROM OLD.vendor_id
       OR NEW.expense_category_id IS DISTINCT FROM OLD.expense_category_id
       OR NEW.date          IS DISTINCT FROM OLD.date
    THEN
      RAISE EXCEPTION
        'expenses %: amount/category/date are locked once approved, reimbursed, or rejected.', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_immutable
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION check_expenses_immutable();
