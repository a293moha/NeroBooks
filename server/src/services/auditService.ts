import type { PoolClient } from "pg";

export interface AuditEntry {
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Writes one audit_logs row. Must be called with the same `client` used
 * for the rest of the request's transaction (from withTenantContext), so
 * the row is written under the same app.current_company_id RLS context —
 * a company's audit trail is exactly as isolated as every other
 * company-owned table, via the same row-level security policy (0017), not
 * a separate mechanism that could drift out of sync.
 *
 * audit_logs itself is append-only twice over: a trigger
 * (prevent_update_delete, 0014) rejects any UPDATE/DELETE outright, and
 * the nerobooks_app role (0015) isn't even granted those privileges on
 * this table — so recording an entry here is a one-way action by
 * construction, not just convention.
 */
export async function recordAuditEntry(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (company_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.companyId,
      entry.actorUserId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ]
  );
}
