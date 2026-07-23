-- 0003_users_and_profiles
-- Platform-wide identities. Not company-scoped: one person can belong to
-- multiple companies (see company_memberships in 0004), matching how a
-- bookkeeper or accountant commonly works across several client companies.

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL,
  password_hash      text NOT NULL,
  email_verified_at  timestamptz,
  status             text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

COMMENT ON TABLE users IS
  'Platform-wide login identity. Never company-scoped directly; see company_memberships.';
COMMENT ON COLUMN users.password_hash IS
  'A password hash produced by the application''s auth library (e.g. argon2/bcrypt). Never store or log the plaintext password anywhere, including here.';
COMMENT ON COLUMN users.deleted_at IS
  'Soft delete only: many other tables reference users via created_by/approved_by for audit purposes, and those references must stay valid after a user leaves.';

-- Case-insensitive uniqueness on active accounts. Deleted (deactivated)
-- accounts don't block a new signup from reusing the same email.
CREATE UNIQUE INDEX idx_users_email_active ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Profile/display data split from the auth-critical `users` row so that
-- editing a display name or avatar never touches the security-sensitive table.
CREATE TABLE user_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone       text,
  avatar_url  text,
  locale      text NOT NULL DEFAULT 'en-US',
  timezone    text NOT NULL DEFAULT 'UTC',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_profiles IS
  '1:1 display/profile data for a user, deliberately separate from the users table.';

CREATE TRIGGER trg_user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
