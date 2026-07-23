-- Rollback for 0004_rbac
DROP TRIGGER IF EXISTS trg_user_roles_check_assignment ON user_roles;
DROP FUNCTION IF EXISTS check_user_role_assignment();
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS company_memberships;
