-- Rollback for 0010_invoicing
DROP TRIGGER IF EXISTS trg_payments_immutable ON payments;
DROP FUNCTION IF EXISTS check_payments_immutable();
DROP TABLE IF EXISTS payments;

DROP TRIGGER IF EXISTS trg_invoice_items_immutable ON invoice_items;
DROP FUNCTION IF EXISTS check_invoice_items_immutable();
DROP TABLE IF EXISTS invoice_items;

DROP TRIGGER IF EXISTS trg_invoices_immutable ON invoices;
DROP FUNCTION IF EXISTS check_invoice_immutable();
DROP TABLE IF EXISTS invoices;
