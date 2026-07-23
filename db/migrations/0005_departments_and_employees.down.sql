-- Rollback for 0005_departments_and_employees
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_manager_employee;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS departments;
