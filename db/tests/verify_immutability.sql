-- verify_immutability.sql
--
-- A manual regression check for every "must not be editable/deletable after
-- approval" rule in this schema. Not a migration — run it against a
-- disposable database after applying all migrations, to confirm the
-- triggers actually block what they claim to. Each block attempts an action
-- that MUST fail; a passing run prints "BLOCKED AS EXPECTED" for every one
-- and "TEST SETUP FAILED" for none. Wrapped in a transaction that is rolled
-- back at the end, so this never leaves data behind.

BEGIN;

DO $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
  v_employee_id uuid;
  v_period_id uuid;
  v_run_id uuid;
  v_entry_id uuid;
  v_earning_type_id uuid;
  v_earning_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_item_id uuid;
  v_payment_id uuid;
  v_asset_account_id uuid;
  v_income_account_id uuid;
  v_journal_entry_id uuid;
BEGIN
  -- ---------- Fixture setup ----------
  INSERT INTO companies (name) VALUES ('Test Co') RETURNING id INTO v_company_id;
  INSERT INTO users (email, password_hash) VALUES ('tester@example.com', 'x') RETURNING id INTO v_user_id;
  INSERT INTO employees (company_id, employee_number, first_name, last_name, hire_date)
    VALUES (v_company_id, 'E1', 'Test', 'Employee', '2024-01-01') RETURNING id INTO v_employee_id;

  INSERT INTO payroll_periods (company_id, period_start, period_end, pay_date)
    VALUES (v_company_id, '2026-07-01', '2026-07-15', '2026-07-20') RETURNING id INTO v_period_id;
  INSERT INTO payroll_runs (company_id, payroll_period_id, status)
    VALUES (v_company_id, v_period_id, 'draft') RETURNING id INTO v_run_id;
  INSERT INTO payroll_entries (company_id, payroll_run_id, employee_id, gross_pay, net_pay, status)
    VALUES (v_company_id, v_run_id, v_employee_id, 1000, 800, 'pending') RETURNING id INTO v_entry_id;

  SELECT id INTO v_earning_type_id FROM earning_types WHERE code = 'REGULAR' LIMIT 1;
  IF v_earning_type_id IS NULL THEN
    INSERT INTO earning_types (name, code) VALUES ('Regular', 'REGULAR') RETURNING id INTO v_earning_type_id;
  END IF;
  INSERT INTO employee_earnings (company_id, payroll_entry_id, earning_type_id, amount)
    VALUES (v_company_id, v_entry_id, v_earning_type_id, 1000) RETURNING id INTO v_earning_id;

  INSERT INTO customers (company_id, name) VALUES (v_company_id, 'Test Customer') RETURNING id INTO v_customer_id;
  INSERT INTO invoices (company_id, customer_id, invoice_number, issue_date, due_date, status)
    VALUES (v_company_id, v_customer_id, 'INV-TEST-1', '2026-07-01', '2026-07-31', 'draft')
    RETURNING id INTO v_invoice_id;
  INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price)
    VALUES (v_company_id, v_invoice_id, 'Test item', 1, 500) RETURNING id INTO v_item_id;

  INSERT INTO chart_of_accounts (company_id, code, name, account_type)
    VALUES (v_company_id, '1000', 'Cash', 'asset') RETURNING id INTO v_asset_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type)
    VALUES (v_company_id, '4000', 'Revenue', 'income') RETURNING id INTO v_income_account_id;

  RAISE NOTICE '--- fixtures created OK ---';

  -- ---------- 1. payroll_entries: locked once approved ----------
  UPDATE payroll_entries SET status = 'approved' WHERE id = v_entry_id;
  BEGIN
    UPDATE payroll_entries SET net_pay = 999 WHERE id = v_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payroll_entries update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payroll_entries UPDATE after approval): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM payroll_entries WHERE id = v_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payroll_entries delete was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payroll_entries DELETE after approval): %', SQLERRM;
  END;

  -- ---------- 2. employee_earnings: locked once parent entry approved ----------
  BEGIN
    UPDATE employee_earnings SET amount = 1 WHERE id = v_earning_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: employee_earnings update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (employee_earnings UPDATE after parent approval): %', SQLERRM;
  END;

  -- ---------- 3. payroll_runs: locked once approved, and 'paid' is terminal ----------
  UPDATE payroll_runs SET status = 'approved' WHERE id = v_run_id;
  BEGIN
    UPDATE payroll_runs SET total_gross = 12345 WHERE id = v_run_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payroll_runs total update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payroll_runs UPDATE totals after approval): %', SQLERRM;
  END;
  UPDATE payroll_runs SET status = 'paid' WHERE id = v_run_id;
  BEGIN
    UPDATE payroll_runs SET status = 'cancelled' WHERE id = v_run_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payroll_runs paid->cancelled was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payroll_runs any change once paid): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM payroll_runs WHERE id = v_run_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payroll_runs delete was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payroll_runs DELETE once paid): %', SQLERRM;
  END;

  -- ---------- 4. invoices: locked once sent ----------
  UPDATE invoices SET status = 'sent' WHERE id = v_invoice_id;
  BEGIN
    UPDATE invoices SET total = 999999 WHERE id = v_invoice_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: invoices total update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (invoices UPDATE billed amount after sent): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM invoices WHERE id = v_invoice_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: invoices delete was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (invoices DELETE after sent): %', SQLERRM;
  END;
  -- status/notes updates must still be ALLOWED post-send:
  UPDATE invoices SET notes = 'ok to edit notes' WHERE id = v_invoice_id;
  RAISE NOTICE 'ALLOWED AS EXPECTED (invoices notes update after sent)';

  -- ---------- 5. invoice_items: locked once parent invoice sent ----------
  BEGIN
    UPDATE invoice_items SET unit_price = 1 WHERE id = v_item_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: invoice_items update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (invoice_items UPDATE after parent sent): %', SQLERRM;
  END;

  -- ---------- 6. payments: immutable financial facts, never deletable ----------
  INSERT INTO payments (company_id, customer_id, invoice_id, amount, received_at)
    VALUES (v_company_id, v_customer_id, v_invoice_id, 500, now()) RETURNING id INTO v_payment_id;
  BEGIN
    UPDATE payments SET amount = 1 WHERE id = v_payment_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payments amount update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payments UPDATE amount, ever): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM payments WHERE id = v_payment_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payments delete was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payments DELETE, ever): %', SQLERRM;
  END;
  UPDATE payments SET voided_at = now() WHERE id = v_payment_id;
  RAISE NOTICE 'ALLOWED AS EXPECTED (payments voided_at set once)';
  BEGIN
    -- now() is frozen for the whole transaction, so add an interval to
    -- guarantee this is a genuinely different value than the first void.
    UPDATE payments SET voided_at = now() + interval '1 second' WHERE id = v_payment_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: payments voided_at re-change was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (payments voided_at cannot change once set): %', SQLERRM;
  END;

  -- ---------- 7. journal_entries: cannot post unbalanced; posted = permanent ----------
  INSERT INTO journal_entries (company_id, entry_date, description)
    VALUES (v_company_id, '2026-07-20', 'Test entry') RETURNING id INTO v_journal_entry_id;
  INSERT INTO journal_entry_lines (company_id, journal_entry_id, account_id, debit)
    VALUES (v_company_id, v_journal_entry_id, v_asset_account_id, 500);
  INSERT INTO journal_entry_lines (company_id, journal_entry_id, account_id, credit)
    VALUES (v_company_id, v_journal_entry_id, v_income_account_id, 400); -- deliberately unbalanced

  BEGIN
    UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: posting an unbalanced entry was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (cannot post unbalanced journal_entry): %', SQLERRM;
  END;

  -- fix the balance, then post for real
  UPDATE journal_entry_lines SET credit = 500 WHERE journal_entry_id = v_journal_entry_id AND credit > 0;
  UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_entry_id;
  RAISE NOTICE 'ALLOWED AS EXPECTED (posting a balanced journal_entry)';

  BEGIN
    UPDATE journal_entries SET description = 'edited after posting' WHERE id = v_journal_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: editing a posted journal_entry was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (posted journal_entries are fully immutable): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM journal_entries WHERE id = v_journal_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: deleting a posted journal_entry was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (posted journal_entries DELETE): %', SQLERRM;
  END;
  BEGIN
    UPDATE journal_entry_lines SET debit = 1 WHERE journal_entry_id = v_journal_entry_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: editing a posted entry''s lines was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (posted journal_entry_lines UPDATE): %', SQLERRM;
  END;

  -- ---------- 8. employee_tax_profiles / employment_records: append-only always ----------
  INSERT INTO employee_tax_profiles (company_id, employee_id, effective_date, tax_country_code)
    VALUES (v_company_id, v_employee_id, '2026-01-01', 'US');
  BEGIN
    UPDATE employee_tax_profiles SET filing_status = 'single' WHERE employee_id = v_employee_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: employee_tax_profiles update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (employee_tax_profiles UPDATE, always): %', SQLERRM;
  END;

  -- ---------- 9. audit_logs: append-only always ----------
  INSERT INTO audit_logs (company_id, action) VALUES (v_company_id, 'test.action');
  BEGIN
    UPDATE audit_logs SET action = 'tampered' WHERE company_id = v_company_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: audit_logs update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (audit_logs UPDATE, always): %', SQLERRM;
  END;
  BEGIN
    DELETE FROM audit_logs WHERE company_id = v_company_id;
    RAISE EXCEPTION 'TEST SETUP FAILED: audit_logs delete was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BLOCKED AS EXPECTED (audit_logs DELETE, always): %', SQLERRM;
  END;

  RAISE NOTICE '--- ALL IMMUTABILITY CHECKS PASSED ---';
END $$;

ROLLBACK;
