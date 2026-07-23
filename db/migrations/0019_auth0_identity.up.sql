-- 0019_auth0_identity
-- Switches user identity from a hand-rolled bcrypt password to Auth0.
-- password_hash becomes nullable because Auth0-provisioned users never have
-- one here — Auth0 owns credential storage entirely now. auth0_sub stores
-- Auth0's stable subject identifier (e.g. "auth0|abc123",
-- "google-oauth2|456"), which is how an incoming, JWT-verified request maps
-- back to our internal users.id — every other table (company_memberships,
-- RLS policies, audit logs, etc.) still keys off users.id, unchanged.
--
-- Additive/relaxing only: adds a nullable unique column and drops a NOT
-- NULL constraint. No existing row loses data, and nothing is deleted.
-- Safe to run against the current dev-only data with no real user accounts.

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN auth0_sub text;

COMMENT ON COLUMN users.password_hash IS
  'A password hash produced by the application''s auth library. NULL for users provisioned via Auth0 (see auth0_sub) -- Auth0 owns credential storage for those accounts, not this table.';
COMMENT ON COLUMN users.auth0_sub IS
  'Auth0''s stable subject identifier for this user (the JWT "sub" claim). NULL only for legacy rows created before the Auth0 migration. This, not email, is the authoritative link between a verified access token and this row.';

CREATE UNIQUE INDEX idx_users_auth0_sub ON users (auth0_sub) WHERE auth0_sub IS NOT NULL AND deleted_at IS NULL;
