-- 02_dev_example_company.sql
--
-- DEVELOPMENT / LOCAL TESTING ONLY. DO NOT RUN AGAINST STAGING OR PRODUCTION.
--
-- Everything below is fictional: fake company, fake people, fake bank/tax
-- numbers. No real person, business, account number, or tax ID appears
-- anywhere in this file.
--
--   * Encrypted-looking columns (account_number_encrypted, etc.) hold the
--     literal placeholder text 'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT',
--     not real ciphertext — there is no encryption key in a seed script.
--   * *_last4 columns use '0000', a value no real account/tax ID ever has
--     printed as its own "last 4" in this dataset.
--   * The login password for every seeded user is the literal string
--     'devpassword123', hashed for real with pgcrypto's bcrypt so you can
--     actually sign in locally. Never use this password or hashing
--     approach in a real environment — see docs/backend-roadmap.md's note
--     on using a real auth provider/library instead of hand-rolled hashing.
--
-- Idempotent: uses a fixed, well-known company id and exits immediately if
-- that company already exists, so re-running this script is a no-op.

DO $$
DECLARE
  v_company_id uuid := '00000000-0000-0000-0000-000000000001';
  v_owner_user_id uuid;
  v_accountant_user_id uuid;
  v_dept_ops_id uuid;
  v_dept_eng_id uuid;
  v_emp1_id uuid;
  v_emp2_id uuid;
  v_customer_id uuid;
  v_vendor_id uuid;
  v_cash_account_id uuid;
  v_ar_account_id uuid;
  v_ap_account_id uuid;
  v_equity_account_id uuid;
  v_income_account_id uuid;
  v_expense_account_id uuid;
  v_expense_category_id uuid;
  v_invoice_id uuid;
  v_period_id uuid;
  v_run_id uuid;
  v_entry_id uuid;
  v_regular_earning_type_id uuid;
  v_password_hash text;
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_company_id) THEN
    RAISE NOTICE 'Dev example company already seeded (id %); skipping.', v_company_id;
    RETURN;
  END IF;

  v_password_hash := crypt('devpassword123', gen_salt('bf'));

  INSERT INTO companies (id, name, legal_name, default_currency, timezone)
    VALUES (v_company_id, 'Example Test Co', 'Example Test Co LLC', 'USD', 'America/New_York');

  INSERT INTO company_settings (company_id) VALUES (v_company_id);

  -- ---------- Users ----------
  INSERT INTO users (email, password_hash, email_verified_at, status)
    VALUES ('owner@example.com', v_password_hash, now(), 'active')
    RETURNING id INTO v_owner_user_id;
  INSERT INTO user_profiles (user_id, full_name) VALUES (v_owner_user_id, 'Alex Owner (Example)');

  INSERT INTO users (email, password_hash, email_verified_at, status)
    VALUES ('accountant@example.com', v_password_hash, now(), 'active')
    RETURNING id INTO v_accountant_user_id;
  INSERT INTO user_profiles (user_id, full_name) VALUES (v_accountant_user_id, 'Jordan Accountant (Example)');

  INSERT INTO company_memberships (company_id, user_id, invited_email, status, accepted_at)
    VALUES
      (v_company_id, v_owner_user_id, 'owner@example.com', 'active', now()),
      (v_company_id, v_accountant_user_id, 'accountant@example.com', 'active', now());

  INSERT INTO user_roles (company_id, user_id, role_id)
    SELECT v_company_id, v_owner_user_id, id FROM roles WHERE name = 'Owner' AND company_id IS NULL;
  INSERT INTO user_roles (company_id, user_id, role_id)
    SELECT v_company_id, v_accountant_user_id, id FROM roles WHERE name = 'Accountant' AND company_id IS NULL;

  -- ---------- Departments ----------
  INSERT INTO departments (company_id, name, code) VALUES (v_company_id, 'Operations', 'OPS')
    RETURNING id INTO v_dept_ops_id;
  INSERT INTO departments (company_id, name, code) VALUES (v_company_id, 'Engineering', 'ENG')
    RETURNING id INTO v_dept_eng_id;

  -- ---------- Employees (fictional people) ----------
  INSERT INTO employees (company_id, department_id, employee_number, first_name, last_name,
                          work_email, hire_date, employment_status, job_title)
    VALUES (v_company_id, v_dept_ops_id, 'EMP-001', 'Sam', 'Sample', 'sam.sample@example.com',
            '2024-01-15', 'active', 'Operations Manager')
    RETURNING id INTO v_emp1_id;

  INSERT INTO employees (company_id, department_id, employee_number, first_name, last_name,
                          work_email, hire_date, employment_status, job_title)
    VALUES (v_company_id, v_dept_eng_id, 'EMP-002', 'Taylor', 'Testperson', 'taylor.testperson@example.com',
            '2024-06-01', 'active', 'Software Engineer')
    RETURNING id INTO v_emp2_id;

  INSERT INTO employee_addresses (company_id, employee_id, address_type, line1, city, state_province, postal_code, country_code)
    VALUES
      (v_company_id, v_emp1_id, 'home', '123 Example Street', 'Springfield', 'IL', '00000', 'US'),
      (v_company_id, v_emp2_id, 'home', '456 Sample Avenue', 'Springfield', 'IL', '00000', 'US');

  INSERT INTO employee_bank_accounts (company_id, employee_id, bank_name, account_holder_name,
                                       account_number_encrypted, account_number_last4,
                                       routing_number_encrypted, account_type, is_primary)
    VALUES
      (v_company_id, v_emp1_id, 'Example Test Bank', 'Sam Sample',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', '0000',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', 'checking', true),
      (v_company_id, v_emp2_id, 'Example Test Bank', 'Taylor Testperson',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', '0000',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', 'checking', true);

  INSERT INTO employee_tax_profiles (company_id, employee_id, effective_date, tax_country_code,
                                      filing_status, tax_id_encrypted, tax_id_last4)
    VALUES
      (v_company_id, v_emp1_id, '2024-01-15', 'US', 'single',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', '0000'),
      (v_company_id, v_emp2_id, '2024-06-01', 'US', 'single',
       'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', '0000');

  INSERT INTO employment_records (company_id, employee_id, effective_date, job_title, department_id,
                                   employment_type, pay_type, pay_rate, reason, created_by)
    VALUES
      (v_company_id, v_emp1_id, '2024-01-15', 'Operations Manager', v_dept_ops_id,
       'full_time', 'salary', 72000.00, 'hire', v_owner_user_id),
      (v_company_id, v_emp2_id, '2024-06-01', 'Software Engineer', v_dept_eng_id,
       'full_time', 'salary', 95000.00, 'hire', v_owner_user_id);

  -- ---------- Customers / Vendors ----------
  INSERT INTO customers (company_id, name, company_name, email, default_currency)
    VALUES (v_company_id, 'Riley Example', 'Example Customer LLC', 'billing@example-customer.com', 'USD')
    RETURNING id INTO v_customer_id;

  INSERT INTO vendors (company_id, name, email, category, default_currency)
    VALUES (v_company_id, 'Example Vendor Co', 'ap@example-vendor.com', 'Software', 'USD')
    RETURNING id INTO v_vendor_id;

  -- ---------- Chart of accounts ----------
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '1000', 'Business Checking', 'asset')      RETURNING id INTO v_cash_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '1010', 'Accounts Receivable', 'asset')    RETURNING id INTO v_ar_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '2000', 'Accounts Payable', 'liability')   RETURNING id INTO v_ap_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '3000', 'Owner''s Equity', 'equity')        RETURNING id INTO v_equity_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '4000', 'Service Income', 'income')        RETURNING id INTO v_income_account_id;
  INSERT INTO chart_of_accounts (company_id, code, name, account_type) VALUES
    (v_company_id, '5000', 'Operating Expenses', 'expense')   RETURNING id INTO v_expense_account_id;

  -- ---------- One draft and one sent invoice ----------
  -- Line items can only be added while an invoice is still a draft (see
  -- trg_invoice_items_immutable), so this always creates as draft, adds
  -- items, then transitions to sent — the same order the application must
  -- follow, not a seed-only shortcut.
  INSERT INTO invoices (company_id, customer_id, invoice_number, issue_date, due_date, status)
    VALUES (v_company_id, v_customer_id, 'INV-1001', current_date - 20, current_date + 10, 'draft')
    RETURNING id INTO v_invoice_id;
  INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, sort_order)
    VALUES (v_company_id, v_invoice_id, 'Example consulting services', 10, 150.00, 0);
  UPDATE invoices SET status = 'sent' WHERE id = v_invoice_id;

  INSERT INTO invoices (company_id, customer_id, invoice_number, issue_date, due_date, status)
    VALUES (v_company_id, v_customer_id, 'INV-1002', current_date, current_date + 30, 'draft')
    RETURNING id INTO v_invoice_id;
  INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, sort_order)
    VALUES (v_company_id, v_invoice_id, 'Example follow-up work', 5, 150.00, 0);

  -- ---------- A couple of expenses ----------
  SELECT id INTO v_expense_category_id FROM expense_categories WHERE name = 'Software' AND company_id IS NULL;
  INSERT INTO expenses (company_id, vendor_id, expense_category_id, date, amount, payment_method, status)
    VALUES (v_company_id, v_vendor_id, v_expense_category_id, current_date - 5, 49.00, 'credit_card', 'pending');

  -- ---------- One in-progress (draft) payroll run ----------
  INSERT INTO payroll_periods (company_id, period_start, period_end, pay_date, status)
    VALUES (v_company_id, date_trunc('month', current_date)::date,
            (date_trunc('month', current_date) + interval '14 days')::date,
            (date_trunc('month', current_date) + interval '19 days')::date, 'open')
    RETURNING id INTO v_period_id;

  INSERT INTO payroll_runs (company_id, payroll_period_id, run_type, status, created_by)
    VALUES (v_company_id, v_period_id, 'regular', 'draft', v_owner_user_id)
    RETURNING id INTO v_run_id;

  SELECT id INTO v_regular_earning_type_id FROM earning_types WHERE code = 'REGULAR' AND company_id IS NULL;

  INSERT INTO payroll_entries (company_id, payroll_run_id, employee_id, gross_pay, total_earnings, net_pay, status)
    VALUES (v_company_id, v_run_id, v_emp1_id, 3000.00, 3000.00, 2400.00, 'pending')
    RETURNING id INTO v_entry_id;
  INSERT INTO employee_earnings (company_id, payroll_entry_id, earning_type_id, amount)
    VALUES (v_company_id, v_entry_id, v_regular_earning_type_id, 3000.00);

  INSERT INTO payroll_entries (company_id, payroll_run_id, employee_id, gross_pay, total_earnings, net_pay, status)
    VALUES (v_company_id, v_run_id, v_emp2_id, 3958.33, 3958.33, 3100.00, 'pending')
    RETURNING id INTO v_entry_id;
  INSERT INTO employee_earnings (company_id, payroll_entry_id, earning_type_id, amount)
    VALUES (v_company_id, v_entry_id, v_regular_earning_type_id, 3958.33);

  -- This run is intentionally left in 'draft' status (not approved/paid) so
  -- that a developer exploring the schema can practice the approve/pay flow
  -- themselves and see the immutability triggers engage — see
  -- db/tests/verify_immutability.sql for an automated version of the same.

  -- ---------- One company bank account ----------
  INSERT INTO bank_accounts (company_id, name, bank_name, account_number_encrypted,
                              account_number_last4, routing_number_encrypted,
                              currency, chart_of_account_id)
    VALUES (v_company_id, 'Main Operating Account', 'Example Test Bank',
            'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', '0000',
            'DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT', 'USD', v_cash_account_id);

  RAISE NOTICE 'Seeded dev example company % (Example Test Co).', v_company_id;
  RAISE NOTICE 'Sign in locally as owner@example.com or accountant@example.com, password: devpassword123';
END $$;
