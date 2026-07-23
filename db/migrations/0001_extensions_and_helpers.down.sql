-- Rollback for 0001_extensions_and_helpers
DROP FUNCTION IF EXISTS prevent_update_delete();
DROP FUNCTION IF EXISTS set_updated_at();
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
