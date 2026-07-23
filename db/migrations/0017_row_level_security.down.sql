-- Rollback for 0017_row_level_security
--
-- Drops every policy created above and disables RLS on every table it was
-- enabled on. Written as a loop over the same table lists for symmetry
-- with the up migration.

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'company_memberships', 'user_roles', 'roles',
    'role_permissions',
    'earning_types', 'deduction_types', 'benefit_types', 'expense_categories',
    'audit_logs', 'notifications',
    'company_settings', 'departments', 'employees', 'employee_addresses',
    'employee_bank_accounts', 'employee_tax_profiles', 'employment_records',
    'payroll_periods', 'payroll_runs', 'payroll_entries', 'employee_earnings',
    'employee_deductions', 'employee_benefits', 'customers', 'vendors',
    'invoices', 'invoice_items', 'payments', 'expenses', 'chart_of_accounts',
    'journal_entries', 'journal_entry_lines', 'bank_accounts',
    'bank_transactions', 'documents'
  ]
  LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
