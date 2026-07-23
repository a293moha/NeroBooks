-- 0015_app_role_and_grants
--
-- The application should connect as this restricted role, never as the
-- migration-running superuser. This is defense-in-depth on top of the
-- triggers added in earlier migrations: even a bug in the application, or
-- someone with only the app's connection string, cannot run UPDATE/DELETE
-- against audit_logs — the grant itself does not exist, independent of any
-- trigger.
--
-- No password is set here on purpose. Set one out-of-band (secrets manager /
-- `ALTER ROLE nerobooks_app PASSWORD '...'` run manually, never committed),
-- or use your cloud provider's IAM-based Postgres auth instead of a
-- password entirely.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nerobooks_app') THEN
    CREATE ROLE nerobooks_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nerobooks_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nerobooks_app;

-- audit_logs: INSERT and SELECT only. Combined with trg_audit_logs_immutable
-- (0014), this means there are two independent reasons an UPDATE/DELETE
-- against this table fails: no grant to even attempt it, and a trigger that
-- would reject it anyway if the grant were ever mistakenly added back.
REVOKE UPDATE, DELETE ON audit_logs FROM nerobooks_app;

-- Ensure the same grants automatically apply to any table added by a
-- migration run after this one, without having to remember to re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nerobooks_app;
