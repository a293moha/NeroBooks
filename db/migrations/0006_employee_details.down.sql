-- Rollback for 0006_employee_details
DROP TRIGGER IF EXISTS trg_employment_records_immutable ON employment_records;
DROP TABLE IF EXISTS employment_records;
DROP TRIGGER IF EXISTS trg_employee_tax_profiles_immutable ON employee_tax_profiles;
DROP TABLE IF EXISTS employee_tax_profiles;
DROP TABLE IF EXISTS employee_bank_accounts;
DROP TABLE IF EXISTS employee_addresses;
