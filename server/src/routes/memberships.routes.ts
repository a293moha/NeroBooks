import { Router } from "express";
import { pool } from "../db/pool.js";
import { withTenantContext } from "../db/context.js";
import { requireAuth, requireCompanyAccess } from "../auth/middleware.js";
import { hasPermission } from "../services/permissionService.js";
import { recordAuditEntry } from "../services/auditService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const meRouter = Router();
meRouter.use(requireAuth);

/**
 * Company switching, part 1: "what am I allowed to switch to." This is a
 * cross-company-by-nature query for one user, so it does not go through
 * requireCompanyAccess (there's no single company to check yet) — instead
 * it relies on the companies_select RLS policy, which itself is defined in
 * terms of company_memberships rather than app.current_company_id (see
 * 0017_row_level_security.up.sql). We still set app.current_user_id via
 * withTenantContext so that policy has something to check against.
 */
meRouter.get(
  "/companies",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId! }, (client) =>
      client.query(
        `SELECT c.id, c.name, c.trading_name, c.default_currency, cm.status AS membership_status
       FROM companies c
       JOIN company_memberships cm ON cm.company_id = c.id
       WHERE cm.user_id = $1 AND cm.status = 'active'
       ORDER BY c.name`,
        [req.userId]
      )
    );
    res.json(result.rows);
  })
);

meRouter.get(
  "/invitations",
  asyncHandler(async (req, res) => {
    const email = await pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [req.userId]);
    const result = await pool.query(
      `SELECT cm.company_id, c.name AS company_name, cm.invited_at
     FROM company_memberships cm
     JOIN companies c ON c.id = cm.company_id
     WHERE cm.invited_email = $1 AND cm.status = 'pending'
     ORDER BY cm.invited_at DESC`,
      [email.rows[0]?.email]
    );
    res.json(result.rows);
  })
);

/**
 * Company switching, part 2: accepting an invitation is precisely how a
 * user gains membership in a company they don't yet have access to — so,
 * like the create-company route, this deliberately runs without
 * requireCompanyAccess. The safety property instead comes from matching
 * strictly on the authenticated user's own verified email: there is no
 * way to accept an invitation addressed to someone else, no matter what
 * companyId is supplied, because the UPDATE's WHERE clause requires
 * invited_email to equal *this* session's own email.
 */
meRouter.post(
  "/invitations/:companyId/accept",
  asyncHandler(async (req, res) => {
    const companyId = req.params.companyId;
    const genericError = { error: "No pending invitation found." };

    // company_memberships_update's RLS policy requires company_id =
    // app.current_company_id, so that GUC has to be set to the *target*
    // company here even though the user has no membership in it yet — the
    // real safety boundary is the WHERE clause below matching strictly on
    // this session's own verified email, not the RLS check, which only
    // requires the caller to have truthfully declared which company this
    // mutation is scoped to (the same pattern company creation uses).
    const updated = await withTenantContext({ userId: req.userId!, companyId }, async (client) => {
      const userEmail = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
        req.userId,
      ]);
      const result = await client.query(
        `UPDATE company_memberships
       SET user_id = $1, status = 'active', accepted_at = now()
       WHERE company_id = $2 AND invited_email = $3 AND status = 'pending'
       RETURNING id, company_id`,
        [req.userId, companyId, userEmail.rows[0]?.email]
      );
      return result.rows[0];
    });

    if (!updated) {
      res.status(404).json(genericError);
      return;
    }
    res.json({ companyId: updated.company_id });
  })
);

// mergeParams: true — same reason as resourcesRouter in resources.routes.ts:
// this router is mounted under `/api/companies/:companyId/members` and needs
// to see the parent's companyId param, both here and inside
// requireCompanyAccess.
export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth, requireCompanyAccess);

membersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, (client) =>
      client.query(
        `SELECT cm.id, cm.invited_email, cm.status, cm.invited_at, cm.accepted_at,
              p.full_name
       FROM company_memberships cm
       LEFT JOIN user_profiles p ON p.user_id = cm.user_id
       WHERE cm.company_id = $1
       ORDER BY cm.invited_at DESC`,
        [req.companyId]
      )
    );
    res.json(result.rows);
  })
);

membersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || email.trim().length === 0) {
      res.status(400).json({ error: "Email is required." });
      return;
    }

    const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
      const allowed = await hasPermission(client, req.companyId!, req.userId!, "users.invite");
      if (!allowed) return "forbidden" as const;

      const inserted = await client.query(
        `INSERT INTO company_memberships (company_id, invited_email, status, invited_by)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT DO NOTHING
       RETURNING id, invited_email, status, invited_at`,
        [req.companyId, email.trim(), req.userId]
      );
      if (inserted.rows[0]) {
        await recordAuditEntry(client, {
          companyId: req.companyId!,
          actorUserId: req.userId!,
          action: "membership.invited",
          entityType: "company_membership",
          entityId: inserted.rows[0].id,
          after: inserted.rows[0],
        });
      }
      return inserted.rows[0] ?? "conflict";
    });

    if (result === "forbidden") {
      res.status(403).json({ error: "Access denied." });
      return;
    }
    if (result === "conflict" || !result) {
      res.status(409).json({ error: "That email already has a pending invitation for this company." });
      return;
    }
    res.status(201).json(result);
  })
);

async function setMembershipStatus(
  req: import("express").Request,
  res: import("express").Response,
  newStatus: "suspended" | "active",
  permissionKey: string,
  action: string
): Promise<void> {
  const membershipId = req.params.membershipId;

  const result = await withTenantContext({ userId: req.userId!, companyId: req.companyId! }, async (client) => {
    const allowed = await hasPermission(client, req.companyId!, req.userId!, permissionKey);
    if (!allowed) return "forbidden" as const;

    const before = await client.query("SELECT * FROM company_memberships WHERE id = $1 AND company_id = $2", [
      membershipId,
      req.companyId,
    ]);
    if (before.rows.length === 0) return null;

    const updated = await client.query(
      `UPDATE company_memberships SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *`,
      [newStatus, membershipId, req.companyId]
    );
    await recordAuditEntry(client, {
      companyId: req.companyId!,
      actorUserId: req.userId!,
      action,
      entityType: "company_membership",
      entityId: membershipId,
      before: before.rows[0],
      after: updated.rows[0],
    });
    return updated.rows[0];
  });

  if (result === "forbidden") {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (!result) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json(result);
}

membersRouter.patch(
  "/:membershipId/suspend",
  asyncHandler((req, res) => setMembershipStatus(req, res, "suspended", "users.manage", "membership.suspended"))
);

membersRouter.patch(
  "/:membershipId/activate",
  asyncHandler((req, res) => setMembershipStatus(req, res, "active", "users.manage", "membership.activated"))
);
