-- Rollback for 0011_expenses
DROP TRIGGER IF EXISTS trg_expenses_immutable ON expenses;
DROP FUNCTION IF EXISTS check_expenses_immutable();
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;
