import type { PoolClient } from "pg";

/**
 * Checks whether the currently-authorized user (implicitly, via the RLS
 * context already set on `client` by withTenantContext) holds a role
 * granting `permissionKey` within the current company. Company-scoped
 * queries here rely on the same RLS policies as everything else — this
 * function does not itself add tenant isolation, it adds *authorization*
 * on top of isolation that's already guaranteed.
 */
export async function hasPermission(
  client: PoolClient,
  companyId: string,
  userId: string,
  permissionKey: string
): Promise<boolean> {
  // The explicit company_id filter here is belt-and-suspenders alongside
  // the RLS policies on user_roles/roles/role_permissions, which already
  // restrict this query to the current tenant context on their own — see
  // "Include company_id in every company-owned query" in
  // docs/multi-tenant-security.md.
  const result = await client.query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.company_id = $1 AND ur.user_id = $2 AND p.key = $3
     LIMIT 1`,
    [companyId, userId, permissionKey]
  );
  return result.rows.length > 0;
}
