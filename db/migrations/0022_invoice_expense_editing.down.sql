-- 0022_invoice_expense_editing (down)
--
-- Restores the original 0010/0011 immutability behavior. Does NOT
-- retroactively undo any post-send invoice edits or post-finalization
-- expense edits made while this migration was applied -- see db/README.md
-- on down-migrations being destructive/non-retroactive by nature. Any such
-- edits remain in the data (and in audit_logs); this only makes the
-- database refuse *new* ones going forward.

ALTER TABLE invoices DROP COLUMN IF EXISTS last_edited_at;

CREATE OR REPLACE FUNCTION check_expenses_immutable() RETURNS trigger AS $$
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

COMMENT ON TABLE expenses IS
  'Deletable/editable while pending; locked once approved/reimbursed/rejected — see trg_expenses_immutable.';

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

COMMENT ON TABLE invoice_items IS
  'amount is a generated column (quantity * unit_price) so it can never drift from its inputs. Immutable once the parent invoice leaves draft — see trg_invoice_items_immutable.';

CREATE OR REPLACE FUNCTION check_invoice_immutable() RETURNS trigger AS $$
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

COMMENT ON TABLE invoices IS
  'Only a draft invoice may be edited or deleted. Once sent, billed amounts/line items/customer/currency are locked — see trg_invoices_immutable. Status and amount_paid remain updatable (status transitions, and amount_paid is maintained as payments come in).';
