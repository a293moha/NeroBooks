import { Pool } from "pg";
import { config, isProduction } from "../config.js";

/**
 * A deliberately separate connection pool, using the nerobooks_platform_admin
 * role (0018), which has BYPASSRLS. Only two files import this, both
 * narrow and audited: routes/platform.routes.ts (cross-tenant platform
 * administration) and services/subscriptionService.ts (the one write
 * company_subscriptions is allowed to receive from outside a platform
 * admin — see 0020 and that file's own comment for why). Never import this
 * from a company-scoped route directly; there is no tenant context to set
 * here (no withTenantContext call site uses this pool) because bypassing
 * RLS is the entire point of holding this credential at all.
 */
export const platformPool = new Pool({
  connectionString: config.platformDatabaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
});
