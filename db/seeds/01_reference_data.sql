-- 01_reference_data.sql
--
-- Platform-wide catalog data with company_id NULL — the global permissions,
-- system roles, and default earning/deduction/benefit/expense-category
-- types every company gets out of the box. This is NOT demo data: run it
-- in every environment (dev, staging, and production) as part of initial
-- setup, right after the migrations. It contains no personal or financial
-- information — only catalog/reference rows.
--
-- Idempotent: safe to re-run (uses ON CONFLICT DO NOTHING throughout).

BEGIN;

-- ---------- Permissions ----------
INSERT INTO permissions (key, description, category) VALUES
  ('companies.manage',   'Edit company profile and settings',       'Company'),
  ('users.invite',       'Invite new users to the company',          'Team'),
  ('users.manage',       'Suspend/remove users, change roles',       'Team'),
  ('roles.manage',       'Create/edit custom roles and permissions', 'Team'),
  ('employees.view',     'View employee records',                    'Payroll'),
  ('employees.manage',   'Create/edit employee records',             'Payroll'),
  ('payroll.view',       'View payroll runs and entries',             'Payroll'),
  ('payroll.run',        'Create and calculate payroll runs',        'Payroll'),
  ('payroll.approve',    'Approve payroll runs for payment',          'Payroll'),
  ('invoices.view',      'View invoices',                             'Sales'),
  ('invoices.create',    'Create and edit draft invoices',            'Sales'),
  ('invoices.send',      'Send an invoice to a customer',             'Sales'),
  ('invoices.delete',    'Delete a draft invoice',                    'Sales'),
  ('expenses.view',      'View expenses',                             'Expenses'),
  ('expenses.create',    'Submit an expense',                        'Expenses'),
  ('expenses.approve',   'Approve or reject a submitted expense',     'Expenses'),
  ('accounting.manage',  'Manage chart of accounts and journal entries', 'Accounting'),
  ('reports.view',       'View financial reports',                    'Reports'),
  ('reports.export',     'Export reports (CSV/Excel)',                'Reports'),
  ('billing.manage',     'View and change the subscription plan',    'Billing')
ON CONFLICT (key) DO NOTHING;

-- ---------- System roles (company_id NULL = available to every company) ----------
INSERT INTO roles (name, description, is_system) VALUES
  ('Owner',        'Full access to everything, including billing.', true),
  ('Admin',        'Full operational access, excluding billing.',   true),
  ('Accountant',   'Full access to accounting and reports.',        true),
  ('Payroll Admin','Full access to payroll, view-only elsewhere.',   true),
  ('Employee',     'Self-service access only.',                     true),
  ('Viewer',       'Read-only access across the company.',          true)
ON CONFLICT (name) WHERE company_id IS NULL DO NOTHING;

-- Owner: every permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Owner' AND r.company_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Admin: everything except billing.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Admin' AND r.company_id IS NULL AND p.key <> 'billing.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Accountant: accounting/reports/invoices/expenses, view-only on payroll/team.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Accountant' AND r.company_id IS NULL AND p.key IN (
  'accounting.manage', 'reports.view', 'reports.export',
  'invoices.view', 'invoices.create', 'invoices.send',
  'expenses.view', 'expenses.approve',
  'payroll.view', 'employees.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Payroll Admin: full payroll access, view-only elsewhere.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Payroll Admin' AND r.company_id IS NULL AND p.key IN (
  'payroll.view', 'payroll.run', 'payroll.approve',
  'employees.view', 'employees.manage', 'reports.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: read-only across the board.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Viewer' AND r.company_id IS NULL AND p.key IN (
  'employees.view', 'payroll.view', 'invoices.view', 'expenses.view', 'reports.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Employee gets no elevated permissions by default (self-service only,
-- handled by application logic outside the permission catalog above).

-- ---------- Default earning types ----------
INSERT INTO earning_types (name, code, is_taxable) VALUES
  ('Regular',   'REGULAR',   true),
  ('Overtime',  'OVERTIME',  true),
  ('Bonus',     'BONUS',     true),
  ('Commission','COMMISSION', true),
  ('Holiday',   'HOLIDAY',   true),
  ('PTO',       'PTO',       true)
ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;

-- ---------- Default deduction types ----------
INSERT INTO deduction_types (name, code, deduction_category) VALUES
  ('Federal Income Tax', 'FED_TAX',  'tax'),
  ('State Income Tax',   'STATE_TAX','tax'),
  ('Social Security',    'FICA_SS',  'tax'),
  ('Medicare',           'FICA_MED', 'tax'),
  ('401k',               '401K',     'pretax'),
  ('Health Insurance',   'HEALTH',   'pretax'),
  ('Wage Garnishment',   'GARNISH',  'garnishment')
ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;

-- ---------- Default benefit types ----------
INSERT INTO benefit_types (name, code, is_employer_paid) VALUES
  ('Health Insurance', 'HEALTH', false),
  ('Dental Insurance',  'DENTAL', false),
  ('Vision Insurance',  'VISION', false),
  ('401k Match',        '401K_MATCH', true),
  ('Life Insurance',    'LIFE', true)
ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;

-- ---------- Default expense categories ----------
INSERT INTO expense_categories (name) VALUES
  ('Advertising'), ('Office Supplies'), ('Travel'), ('Utilities'),
  ('Rent'), ('Software'), ('Payroll'), ('Insurance'), ('Other')
ON CONFLICT (name) WHERE company_id IS NULL DO NOTHING;

COMMIT;
