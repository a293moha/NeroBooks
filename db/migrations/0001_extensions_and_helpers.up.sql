-- 0001_extensions_and_helpers
-- Extensions and reusable trigger functions used by every later migration.

-- gen_random_uuid() for UUID primary keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Case-insensitive email storage/uniqueness (users.email, etc.).
CREATE EXTENSION IF NOT EXISTS citext;

-- Generic "bump updated_at on every UPDATE" trigger, attached per-table below.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Sets updated_at = now() on every UPDATE. Attach as a BEFORE UPDATE trigger.';

-- Generic "this table is append-only, no UPDATE or DELETE, ever" guard.
-- Used for tables where even the app's own service role must never be able
-- to rewrite history (audit_logs).
CREATE FUNCTION prevent_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Records in table "%" are append-only and cannot be updated or deleted.',
    TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_update_delete() IS
  'Unconditionally blocks UPDATE and DELETE. Attach as a BEFORE UPDATE OR DELETE trigger on append-only tables.';
