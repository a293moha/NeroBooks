-- Rollback for 0007_payroll_core
DROP TRIGGER IF EXISTS trg_payroll_entries_immutable ON payroll_entries;
DROP FUNCTION IF EXISTS check_payroll_entry_immutable();
DROP TABLE IF EXISTS payroll_entries;
DROP TRIGGER IF EXISTS trg_payroll_runs_immutable ON payroll_runs;
DROP FUNCTION IF EXISTS check_payroll_run_immutable();
DROP TABLE IF EXISTS payroll_runs;
DROP TABLE IF EXISTS payroll_periods;
