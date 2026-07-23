import type { PoolClient } from "pg";
import { pool } from "./pool.js";

/**
 * The only two facts every tenant-scoped database query is allowed to run
 * under. `companyId` is deliberately optional at the type level — routes
 * that haven't yet verified company membership (see
 * ../auth/middleware.ts requireCompanyAccess) must not be able to pass one
 * in, by construction, not just by convention.
 *
 * Both fields must always come from server-verified state (a decoded,
 * signature-checked session token for userId; a database-confirmed active
 * company_memberships row for companyId) — never from a request body,
 * header, or query string taken at face value.
 */
export interface TenantContext {
  userId: string;
  companyId?: string;
}

/**
 * Runs `fn` inside a single transaction with the Postgres session
 * variables `app.current_user_id` / `app.current_company_id` set via
 * `set_config(..., true)` — the `true` (is_local) makes the setting
 * transaction-scoped, so it is automatically cleared on COMMIT/ROLLBACK and
 * can never leak into a different request that later reuses this pooled
 * connection.
 *
 * Every one of the row-level security policies in
 * db/migrations/0017_row_level_security.up.sql reads these two variables.
 * This function is the *only* place in the codebase that sets them —
 * route handlers and services never touch Postgres session state directly,
 * so there is exactly one place to audit for correctness.
 *
 * Uses parameterized set_config() calls, not string-interpolated SQL, so
 * there is no injection risk even though these values are UUIDs the
 * application already validated — defense in depth costs nothing here.
 */
export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
    if (ctx.companyId) {
      await client.query("SELECT set_config('app.current_company_id', $1, true)", [ctx.companyId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
