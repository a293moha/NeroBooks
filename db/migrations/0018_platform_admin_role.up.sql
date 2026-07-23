-- 0018_platform_admin_role
--
-- Platform-level administration (e.g. "list every company on the
-- platform," "suspend any company") is a genuinely cross-tenant
-- operation — the row-level security policies in 0017 are specifically
-- designed to make cross-tenant reads impossible for a normal request, so
-- a platform admin needs a deliberately separate credential, not a flag
-- threaded through every existing policy.
--
-- nerobooks_platform_admin has BYPASSRLS and is used by exactly one file
-- in the codebase (server/src/db/platformPool.ts), imported by exactly one
-- route module (server/src/routes/platform.routes.ts) — a company
-- Owner/Admin's request never touches this pool no matter how privileged
-- they are within their own company, because that route module also
-- requires req.isPlatformAdmin (users.is_platform_admin, 0016) before it
-- runs any query at all. Two independent things must both be true — a
-- platform-admin *database credential* the process holds, and a
-- platform-admin *flag* on the authenticated user — for any platform
-- route to do anything.
--
-- No password is set here, same reasoning as nerobooks_app in 0015: set it
-- out-of-band, never commit it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nerobooks_platform_admin') THEN
    CREATE ROLE nerobooks_platform_admin LOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nerobooks_platform_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nerobooks_platform_admin;
REVOKE UPDATE, DELETE ON audit_logs FROM nerobooks_platform_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nerobooks_platform_admin;
