-- Rollback for 0014_documents_audit_notifications
DROP TABLE IF EXISTS notifications;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS documents;
