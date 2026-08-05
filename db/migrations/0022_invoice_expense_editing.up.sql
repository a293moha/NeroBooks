-- 0022_invoice_expense_editing
--
-- Product decision (2026-08-05): invoices and expenses must be editable
-- after they leave their initial state (Sent/Paid/Overdue invoices,
-- Approved/Reimbursed/Rejected expenses), because real usage needs to fix
-- a wrong customer, line item, or amount on a record that already went
-- out -- the original "financial facts are permanently locked" triggers
-- from 0010/0011 were stricter than the product actually wants. The
-- integrity guarantee moves from "the database physically refuses the
-- write" to "every write is warned about client-side (for Paid invoices /
-- finalized expenses) and fully recorded in audit_logs with before/after
-- values" -- see recordAuditEntry call sites in resources.routes.ts for
-- the invoice/expense edit endpoints. This is a deliberate loosening, not
-- an oversight; see db/README.md's note that down-migrations against real
-- data are destructive -- rolling this back on a database that already
-- has post-send invoice edits will not retroactively undo them, it only
-- restores the old trigger going forward.
--
-- What stays locked, even after this migration:
--   * invoices.invoice_number and invoices.company_id -- identity/
--     allocation invariants, never editable by any path, still enforced
--     by check_invoice_immutable().
--   * A non-draft invoice still cannot be DELETEd (only status-transitioned
--     or edited in place) -- unchanged from 0010.
--   * A non-pending expense still cannot be DELETEd -- unchanged from 0011.

CREATE OR REPLACE FUNCTION check_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'invoices %: only a draft invoice can be deleted (status is %).', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- Identity/allocation invariants: locked at every status, not just
  -- once sent. Everything else (customer, currency, amounts, dates, line
  -- items) is editable regardless of status -- see 0022's header comment.
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
  THEN
    RAISE EXCEPTION
      'invoices %: company_id and invoice_number can never change.', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE invoices IS
  'Editable at any status (customer/dates/line items/amounts/status) via the app''s invoice-edit endpoint -- see 0022. Only invoice_number and company_id are permanently locked (check_invoice_immutable). A non-draft invoice still cannot be deleted. Every edit is recorded in audit_logs with before/after values, and last_edited_at is stamped, since the database no longer refuses these writes on its own.';

-- Line items: previously fully locked once the parent invoice left
-- 'draft' (trg_invoice_items_immutable / check_invoice_items_immutable
-- from 0010). Editing line items on a Sent/Paid/Overdue invoice is now a
-- supported product flow, so that trigger no longer serves a purpose --
-- removed outright rather than left as a permissive no-op trigger.
DROP TRIGGER IF EXISTS trg_invoice_items_immutable ON invoice_items;
DROP FUNCTION IF EXISTS check_invoice_items_immutable();

COMMENT ON TABLE invoice_items IS
  'amount is a generated column (quantity * unit_price) so it can never drift from its inputs. Editable at any parent invoice status -- see 0022 (previously locked once the parent left draft).';

ALTER TABLE invoices ADD COLUMN last_edited_at timestamptz;

COMMENT ON COLUMN invoices.last_edited_at IS
  'Set only by the explicit invoice-edit endpoint (PATCH /invoices/:id), never by status transitions or payment application -- distinguishes "someone changed this invoice''s content after issuing it" from ordinary lifecycle progress, for the "Last edited: <date>" note shown in the UI.';

CREATE OR REPLACE FUNCTION check_expenses_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'expenses %: only a pending expense can be deleted (status is %).', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- amount/currency/vendor/category/date are no longer locked once
  -- approved/reimbursed/rejected -- editing a finalized expense is now a
  -- supported product flow (client warns first; audit_logs records the
  -- before/after diff) -- see 0022's header comment.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE expenses IS
  'Editable at any status via the app''s expense-edit endpoint -- see 0022 (previously locked once approved/reimbursed/rejected). Still only deletable while pending. Every edit is recorded in audit_logs with before/after values.';
