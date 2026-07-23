-- Rollback for 0008_payroll_lines
DROP TRIGGER IF EXISTS trg_employee_benefits_immutable ON employee_benefits;
DROP FUNCTION IF EXISTS check_employee_benefits_immutable();
DROP TABLE IF EXISTS employee_benefits;
DROP TABLE IF EXISTS benefit_types;

DROP TRIGGER IF EXISTS trg_employee_deductions_immutable ON employee_deductions;
DROP FUNCTION IF EXISTS check_employee_deductions_immutable();
DROP TABLE IF EXISTS employee_deductions;
DROP TABLE IF EXISTS deduction_types;

DROP TRIGGER IF EXISTS trg_employee_earnings_immutable ON employee_earnings;
DROP FUNCTION IF EXISTS check_employee_earnings_immutable();
DROP FUNCTION IF EXISTS check_payroll_line_immutable_via_entry(uuid);
DROP TABLE IF EXISTS employee_earnings;
DROP TABLE IF EXISTS earning_types;
