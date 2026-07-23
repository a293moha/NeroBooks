-- 0014_documents_audit_notifications

CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  owner_type       text NOT NULL,
  owner_id         uuid NOT NULL,
  file_name        text NOT NULL,
  file_size_bytes  bigint,
  content_type     text,
  storage_path     text NOT NULL,
  uploaded_by      uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE documents IS
  'Metadata only — the actual file bytes live in object storage (e.g. S3) at storage_path; this table is never used to store a file blob directly. owner_type/owner_id are an application-enforced polymorphic reference (e.g. owner_type=''expense''), same pattern as journal_entries.source_type/source_id. Soft-deleted: deleting here marks intent and the app/background job removes the underlying object separately; the metadata trail (who uploaded what, when) is retained.';

CREATE INDEX idx_documents_company ON documents (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_owner ON documents (owner_type, owner_id);

CREATE TRIGGER trg_documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only. Uses the generic prevent_update_delete() guard from 0001 —
-- no row in this table may ever be changed or removed, by anyone, including
-- a compromised or buggy application connection (see 0015 for the
-- role-grant-level backstop on top of this trigger).
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES companies (id),
  actor_user_id  uuid REFERENCES users (id),
  action         text NOT NULL,
  entity_type    text,
  entity_id      uuid,
  before_data    jsonb,
  after_data     jsonb,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_logs IS
  'Append-only. company_id/actor_user_id are nullable to allow platform-level or system/automated actions not tied to a company or a human user. No updated_at/deleted_at by design — nothing here is ever mutated.';

CREATE INDEX idx_audit_logs_company ON audit_logs (company_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications IS
  'Ephemeral, no historical/compliance value once read and old. The one table in this schema with no soft-delete and no special immutability rule — hard DELETE (e.g. via a periodic cleanup job for old read notifications) is fine.';

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_company ON notifications (company_id);

CREATE TRIGGER trg_notifications_set_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
