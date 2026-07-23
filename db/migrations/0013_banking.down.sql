-- Rollback for 0013_banking
DROP TRIGGER IF EXISTS trg_bank_transactions_immutable ON bank_transactions;
DROP FUNCTION IF EXISTS check_bank_transactions_immutable();
DROP TABLE IF EXISTS bank_transactions;
DROP TABLE IF EXISTS bank_accounts;
