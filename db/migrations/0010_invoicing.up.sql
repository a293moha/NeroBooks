-- 0010_invoicing

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers (id),
  invoice_number  text NOT NULL,
  issue_date      date NOT NULL,
  due_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void')),
  currency        char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal        numeric(19,4) NOT NULL DEFAULT 0,
  tax_total       numeric(19,4) NOT NULL DEFAULT 0,
  total           numeric(19,4) NOT NULL DEFAULT 0,
  amount_paid     numeric(19,4) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (company_id, invoice_number),
  CHECK (due_date >= issue_date)
);

COMMENT ON TABLE invoices IS
  'Only a draft invoice may be edited or deleted. Once sent, billed amounts/line items/customer/currency are locked — see trg_invoices_immutable. Status and amount_paid remain updatable (status transitions, and amount_paid is maintained as payments come in).';

CREATE INDEX idx_invoices_company ON invoices (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_customer ON invoices (customer_id);
CREATE INDEX idx_invoices_status ON invoices (company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_due_date ON invoices (company_id, due_date) WHERE status NOT IN ('paid', 'void');

CREATE TRIGGER trg_invoices_set_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'invoices %: only a draft invoice can be deleted (status is %).', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.company_id  IS DISTINCT FROM OLD.company_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.currency     IS DISTINCT FROM OLD.currency
       OR NEW.subtotal     IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_total    IS DISTINCT FROM OLD.tax_total
       OR NEW.total        IS DISTINCT FROM OLD.total
       OR NEW.issue_date   IS DISTINCT FROM OLD.issue_date
       OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
    THEN
      RAISE EXCEPTION
        'invoices %: billed amounts and identity fields are locked once sent. Only status, due_date, amount_paid, and notes may change.',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_immutable
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION check_invoice_immutable();

CREATE TABLE invoice_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description  text NOT NULL,
  quantity     numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price   numeric(19,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount       numeric(19,4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoice_items IS
  'amount is a generated column (quantity * unit_price) so it can never drift from its inputs. Immutable once the parent invoice leaves draft — see trg_invoice_items_immutable.';

CREATE INDEX idx_invoice_items_company ON invoice_items (company_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);

CREATE TRIGGER trg_invoice_items_set_updated_at
  BEFORE UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_invoice_items_immutable() RETURNS trigger AS $$
DECLARE
  parent_status text;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO parent_status FROM invoices WHERE id = parent_id;

  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION
      'invoice_items: parent invoice % is no longer a draft (status %); line items are locked.',
      parent_id, parent_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_items_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION check_invoice_items_immutable();

-- Payments are financial facts: never edited after creation, never
-- hard-deleted. A mistaken payment is corrected by setting voided_at
-- (once) and recording an offsetting/replacement payment, not by changing
-- amounts in place.
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  invoice_id      uuid REFERENCES invoices (id),
  customer_id     uuid NOT NULL REFERENCES customers (id),
  amount          numeric(19,4) NOT NULL CHECK (amount <> 0),
  currency        char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method  text NOT NULL DEFAULT 'bank_transfer'
                     CHECK (payment_method IN
                       ('bank_transfer', 'credit_card', 'debit_card', 'cash', 'check', 'other')),
  reference       text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE payments IS
  'invoice_id is nullable to allow recording an unapplied/advance payment before it is matched to an invoice. Fully immutable except for a one-time voided_at — see trg_payments_immutable. Never hard-deleted, ever.';

CREATE INDEX idx_payments_company ON payments (company_id);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_customer ON payments (customer_id);

CREATE TRIGGER trg_payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION check_payments_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments %: payment records are never deleted. Void it instead.', OLD.id;
  END IF;

  IF NEW.company_id     IS DISTINCT FROM OLD.company_id
     OR NEW.invoice_id    IS DISTINCT FROM OLD.invoice_id
     OR NEW.customer_id   IS DISTINCT FROM OLD.customer_id
     OR NEW.amount        IS DISTINCT FROM OLD.amount
     OR NEW.currency      IS DISTINCT FROM OLD.currency
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.reference     IS DISTINCT FROM OLD.reference
     OR NEW.received_at   IS DISTINCT FROM OLD.received_at
  THEN
    RAISE EXCEPTION 'payments %: payment facts cannot be edited. Only voided_at may be set once.', OLD.id;
  END IF;

  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION 'payments %: voided_at cannot be changed once set.', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_immutable
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION check_payments_immutable();
