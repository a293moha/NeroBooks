-- 0005_departments_and_employees
-- departments.manager_employee_id and employees.department_id reference each
-- other, so departments is created first without that one FK, employees is
-- created referencing departments, and the missing FK is added back at the
-- end once both tables exist.

CREATE TABLE departments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name                 text NOT NULL,
  code                 text,
  manager_employee_id  uuid, -- FK added below, after employees exists
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  UNIQUE (company_id, name)
);

COMMENT ON TABLE departments IS
  'Soft-deleted (never hard-deleted): historical employment_records and payroll data reference a department long after it is deactivated.';

CREATE INDEX idx_departments_company ON departments (company_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id            uuid REFERENCES users (id),
  department_id      uuid REFERENCES departments (id),
  employee_number    text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  preferred_name     text,
  work_email         citext,
  personal_email     citext,
  date_of_birth      date,
  hire_date          date NOT NULL,
  termination_date   date,
  employment_status  text NOT NULL DEFAULT 'active'
                        CHECK (employment_status IN ('active', 'on_leave', 'terminated')),
  job_title          text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (company_id, employee_number),
  CHECK (termination_date IS NULL OR termination_date >= hire_date)
);

COMMENT ON TABLE employees IS
  'Never hard-deleted while any payroll_entries/employment_records reference the row (enforced by those tables'' FKs using ON DELETE RESTRICT). deleted_at exists only for "this record was created in error" corrections, and is distinct from termination_date, which is the real business event of an employee leaving — a terminated employee''s row must remain fully intact and non-deleted for payroll history.';
COMMENT ON COLUMN employees.date_of_birth IS
  'Sensitive PII. See docs/database-schema.md and docs/security-risks.md for encryption/retention guidance.';

CREATE INDEX idx_employees_company ON employees (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_department ON employees (department_id);
CREATE INDEX idx_employees_user ON employees (user_id);
CREATE INDEX idx_employees_status ON employees (company_id, employment_status) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_employees_set_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Now that employees exists, wire up the manager reference. ON DELETE SET
-- NULL: losing a manager assignment should not block deleting/deactivating
-- the manager's own employee record.
ALTER TABLE departments
  ADD CONSTRAINT fk_departments_manager_employee
  FOREIGN KEY (manager_employee_id) REFERENCES employees (id) ON DELETE SET NULL;

CREATE INDEX idx_departments_manager ON departments (manager_employee_id);
