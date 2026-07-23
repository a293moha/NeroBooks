-- Rollback for 0012_general_ledger
DROP TRIGGER IF EXISTS trg_journal_entry_lines_immutable ON journal_entry_lines;
DROP FUNCTION IF EXISTS check_journal_entry_lines_immutable();
DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
DROP FUNCTION IF EXISTS check_journal_entry_immutable();
DROP TABLE IF EXISTS journal_entry_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS chart_of_accounts;
