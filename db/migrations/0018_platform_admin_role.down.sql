-- Rollback for 0018_platform_admin_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM nerobooks_platform_admin;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM nerobooks_platform_admin;
REVOKE USAGE ON SCHEMA public FROM nerobooks_platform_admin;
DROP ROLE IF EXISTS nerobooks_platform_admin;
