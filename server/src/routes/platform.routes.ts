import { Router } from "express";
import { platformPool } from "../db/platformPool.js";
import { requireAuth, requirePlatformAdmin } from "../auth/middleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Platform-level administration: operations that legitimately span every
 * company on the platform. Gated by TWO independent things, both required:
 *
 *   1. requirePlatformAdmin — the authenticated user's own
 *      users.is_platform_admin flag (0016), checked at the application
 *      layer. A company Owner/Admin, no matter how privileged within
 *      their own company, has this set to false and is rejected here with
 *      the same 403 used everywhere else in this codebase for
 *      unauthorized access.
 *   2. platformPool — a completely separate database credential
 *      (nerobooks_platform_admin, 0018) that bypasses row-level security.
 *      This module is the only file in the codebase that imports it.
 *
 * No withTenantContext call appears anywhere in this file — there is no
 * single tenant to scope these queries to; that is the entire point of a
 * platform-admin route existing at all.
 */
export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformAdmin);

platformRouter.get(
  "/companies",
  asyncHandler(async (_req, res) => {
    const result = await platformPool.query(
      `SELECT id, name, trading_name, status, created_at
     FROM companies WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    res.json(result.rows);
  })
);

platformRouter.patch(
  "/companies/:companyId/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body ?? {};
    if (!["active", "suspended", "closed"].includes(status)) {
      res.status(400).json({ error: "status must be one of: active, suspended, closed." });
      return;
    }

    const client = await platformPool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query("SELECT * FROM companies WHERE id = $1", [req.params.companyId]);
      if (before.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found." });
        return;
      }
      const updated = await client.query("UPDATE companies SET status = $1 WHERE id = $2 RETURNING *", [
        status,
        req.params.companyId,
      ]);
      // Platform-level actions are recorded with company_id set to the
      // affected company (so that company's own audit view — itself
      // properly RLS-scoped — can see it was suspended) but actor context
      // makes clear it was a platform action, not a self-service one.
      await client.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES ($1, $2, 'platform.company_status_changed', 'company', $1, $3, $4)`,
        [req.params.companyId, req.userId, JSON.stringify(before.rows[0]), JSON.stringify(updated.rows[0])]
      );
      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);
