DROP INDEX IF EXISTS idx_users_auth0_sub;

ALTER TABLE users
  DROP COLUMN IF EXISTS auth0_sub;

-- Only safe to restore NOT NULL if every remaining row still has a
-- password_hash. If any Auth0-provisioned (password_hash IS NULL) rows
-- exist, this rollback will fail loudly rather than silently corrupt data --
-- resolve those rows (e.g. by removing them, since they only make sense
-- alongside the Auth0 migration this reverts) before rolling back further.
ALTER TABLE users
  ALTER COLUMN password_hash SET NOT NULL;
