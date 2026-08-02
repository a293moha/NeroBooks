import { Pool } from "pg";
import { config, isProduction } from "../config.js";

/**
 * A deliberately separate connection pool, using the nerobooks_platform_admin
 * role (0018), which has BYPASSRLS. This file must be imported by exactly
 * one route module — routes/platform.routes.ts — and never by any
 * company-scoped route. There is no tenant context to set here (no
 * withTenantContext call site uses this pool): platform operations are
 * cross-tenant by definition, which is exactly why this needs its own
 * credential instead of a flag threaded through the normal RLS policies.
 */
export const platformPool = new Pool({
  connectionString: config.platformDatabaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
});
