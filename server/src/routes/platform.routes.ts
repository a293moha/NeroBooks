import { randomUUID } from "node:crypto";
import { Router } from "express";
import { platformPool } from "../db/platformPool.js";
import { requireAuth, requirePlatformAdmin } from "../auth/middleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { provisionAuth0User, createPasswordSetupTicket } from "../auth/auth0Management.js";
import { createCompanyWithOwner } from "../services/companyService.js";
import { recordAuditEntry } from "../services/auditService.js";
import { config } from "../config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PLANS = ["easystart", "plus", "advanced"];

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

/**
 * Admin-driven customer onboarding: register a brand-new customer by
 * email alone (no password collected here at all — see
 * auth/auth0Management.ts) and set which pricing tier they're on. Real
 * accounting/payroll customers are frequently onboarded outside a
 * self-serve checkout (invoiced, sales-assisted, etc.), and until real
 * Stripe billing exists (docs/backend-roadmap.md Phase 2) this is the
 * only way for a company's plan tier to become a real, server-side fact
 * rather than the client-side preview toggle it used to be exclusively.
 *
 * The Auth0 user is created first, outside the database transaction — it
 * cannot be rolled back if our own insert then fails, so committing our
 * side only after Auth0 confirms success avoids ever holding a local user
 * with no real identity behind it (the reverse failure, an orphaned Auth0
 * user with no local company, is an acceptable and manually-resolvable
 * failure mode for this admin-driven, low-volume flow).
 */
platformRouter.post(
  "/customers",
  asyncHandler(async (req, res) => {
    const { email, companyName, plan } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "A valid email is required." });
      return;
    }
    if (typeof companyName !== "string" || companyName.trim().length === 0) {
      res.status(400).json({ error: "Company name is required." });
      return;
    }
    if (typeof plan !== "string" || !VALID_PLANS.includes(plan)) {
      res.status(400).json({ error: `plan must be one of: ${VALID_PLANS.join(", ")}.` });
      return;
    }

    const existing = await platformPool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [
      email,
    ]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "A user with that email already exists." });
      return;
    }

    const { auth0Sub } = await provisionAuth0User(email);

    const client = await platformPool.connect();
    let userId: string;
    let companyId: string;
    try {
      await client.query("BEGIN");

      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, auth0_sub, status) VALUES ($1, $2, 'active') RETURNING id`,
        [email, auth0Sub]
      );
      userId = userResult.rows[0].id;
      await client.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)", [
        userId,
        email.split("@")[0],
      ]);

      companyId = randomUUID();
      await createCompanyWithOwner(client, { companyId, ownerUserId: userId, name: companyName.trim() });

      await client.query(
        "INSERT INTO company_subscriptions (company_id, plan, set_by_user_id) VALUES ($1, $2, $3)",
        [companyId, plan, req.userId]
      );

      await recordAuditEntry(client, {
        companyId,
        actorUserId: req.userId!,
        action: "platform.customer_registered",
        entityType: "company",
        entityId: companyId,
        after: { email, companyName: companyName.trim(), plan },
      });

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Deliberately outside the transaction: our own rows are already
    // committed by this point, so a failure here still leaves a fully
    // working customer + company behind — just without a ready-made
    // setup link, which can be regenerated by calling this endpoint's
    // ticket logic again by hand if it ever comes to that (no such retry
    // endpoint exists yet, since this is a low-volume, admin-driven flow).
    let passwordSetupUrl: string | null = null;
    try {
      passwordSetupUrl = await createPasswordSetupTicket(auth0Sub, config.primaryFrontendUrl);
    } catch (err) {
      console.error("Failed to create password-setup ticket after successful customer registration", err);
    }

    res.status(201).json({ userId, companyId, email, plan, passwordSetupUrl });
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
