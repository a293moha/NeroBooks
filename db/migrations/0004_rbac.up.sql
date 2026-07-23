-- 0004_rbac
-- Company membership + role-based access control.

CREATE TABLE company_memberships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users (id) ON DELETE CASCADE,
  invited_email  citext NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  invited_by     uuid REFERENCES users (id),
  invited_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending' AND user_id IS NULL)
    OR (status <> 'pending' AND user_id IS NOT NULL)
  )
);

COMMENT ON TABLE company_memberships IS
  'Links a user to a company they belong to. A row can exist before the invited person has a users account yet (status=pending, user_id NULL, invited_email set); it is filled in with user_id once they accept.';

-- One membership per (company, user) once accepted, and one pending invite
-- per (company, email) at a time.
CREATE UNIQUE INDEX idx_company_memberships_company_user
  ON company_memberships (company_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_company_memberships_company_invite
  ON company_memberships (company_id, invited_email) WHERE status = 'pending';
CREATE INDEX idx_company_memberships_company ON company_memberships (company_id);
CREATE INDEX idx_company_memberships_user ON company_memberships (user_id);

CREATE TRIGGER trg_company_memberships_set_updated_at
  BEFORE UPDATE ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roles: either global/system-defined (company_id IS NULL, available to every
-- company — e.g. "Owner", "Accountant") or a custom role scoped to one company.
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roles IS
  'company_id NULL = built-in role available to all companies (e.g. Owner, Accountant). company_id set = a custom role defined by that one company.';
COMMENT ON COLUMN roles.is_system IS
  'true for built-in roles that ship with the platform; the application should refuse to let a user delete or rename these.';

CREATE UNIQUE INDEX idx_roles_global_name ON roles (name) WHERE company_id IS NULL;
CREATE UNIQUE INDEX idx_roles_company_name ON roles (company_id, name) WHERE company_id IS NOT NULL;
CREATE INDEX idx_roles_company ON roles (company_id);

CREATE TRIGGER trg_roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  description text,
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE permissions IS
  'Fixed, platform-defined permission catalog, e.g. key = "payroll.approve". Rows are managed by the application/deploy process, not end users.';
COMMENT ON COLUMN permissions.key IS
  'Stable machine-readable identifier checked by the API authorization layer, e.g. "invoices.create".';

CREATE TABLE role_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id        uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id  uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

COMMENT ON TABLE role_permissions IS
  'Junction: which permissions a role grants. No soft delete — removing a permission from a role is a real removal; history is in audit_logs if needed. updated_at is present for schema consistency but a junction row''s columns are its identity, so in practice it never diverges from created_at — a "change" is a delete + insert, not an update.';

CREATE INDEX idx_role_permissions_role ON role_permissions (role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);

CREATE TRIGGER trg_role_permissions_set_updated_at
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id      uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  assigned_by  uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, role_id)
);

COMMENT ON TABLE user_roles IS
  'Assigns a role to a user within one specific company. A global role (roles.company_id IS NULL) can be assigned within any company; a custom role can only sensibly be assigned within its own company_id (enforced by trigger below, alongside the active-membership check).';

CREATE INDEX idx_user_roles_company ON user_roles (company_id);
CREATE INDEX idx_user_roles_user ON user_roles (user_id);

CREATE TRIGGER trg_user_roles_set_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

-- Integrity guard: you can only be assigned a role within a company you are
-- an active member of, and a custom (company-scoped) role can only be
-- assigned within its own company.
CREATE FUNCTION check_user_role_assignment() RETURNS trigger AS $$
DECLARE
  membership_ok boolean;
  role_company_id uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM company_memberships
    WHERE company_id = NEW.company_id
      AND user_id = NEW.user_id
      AND status = 'active'
  ) INTO membership_ok;

  IF NOT membership_ok THEN
    RAISE EXCEPTION
      'Cannot assign a role to user % in company %: no active company_membership exists.',
      NEW.user_id, NEW.company_id;
  END IF;

  SELECT company_id INTO role_company_id FROM roles WHERE id = NEW.role_id;

  IF role_company_id IS NOT NULL AND role_company_id <> NEW.company_id THEN
    RAISE EXCEPTION
      'Role % belongs to a different company than %.', NEW.role_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_roles_check_assignment
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION check_user_role_assignment();
