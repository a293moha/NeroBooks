import type { Request, Response } from "express";
import { pool } from "../db/pool.js";
import { withTenantContext } from "../db/context.js";
import { config } from "../config.js";
import { verifySession } from "./jwt.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * A single, deliberately uninformative response for every authorization
 * failure in this file. Whether the company doesn't exist, the user was
 * never invited, or their membership was suspended yesterday — the client
 * sees exactly the same thing either way. Distinguishing those cases in the
 * response is exactly how an attacker maps out which company IDs/record
 * IDs are real; see docs/multi-tenant-security.md.
 */
function denyAccess(res: Response): void {
  res.status(403).json({ error: "Access denied." });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies the session cookie and attaches req.userId. Also re-reads the
 * user's status and is_platform_admin flag from the database on every
 * request (not just decoded from the token) — a suspended/deactivated
 * account loses access immediately, without waiting for its token to
 * expire.
 *
 * Wrapped in asyncHandler: this is Express middleware, not just a route
 * handler, and the same "Express 4 doesn't catch async rejections"
 * problem applies to middleware too — a DB error in here must reach
 * errorHandler.ts, not hang the request.
 */
export const requireAuth = asyncHandler(async (req: Request, res: Response, next) => {
  const token = req.cookies?.[config.cookieName];
  const session = typeof token === "string" ? verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const result = await pool.query<{ id: string; status: string; is_platform_admin: boolean }>(
    "SELECT id, status, is_platform_admin FROM users WHERE id = $1 AND deleted_at IS NULL",
    [session.userId]
  );
  const user = result.rows[0];

  if (!user || user.status !== "active") {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  req.userId = user.id;
  req.isPlatformAdmin = user.is_platform_admin;
  next();
});

/**
 * The core tenant-isolation check. Reads a company id the client
 * *requested* from req.params.companyId, but — critically — never uses
 * that value for anything until an active company_memberships row proves
 * the authenticated user (req.userId, set by requireAuth, itself derived
 * from a verified session token) is actually allowed into it. Only after
 * that independent database check passes does req.companyId get set to
 * the server-confirmed value that route handlers and withTenantContext
 * are allowed to rely on.
 *
 * A malformed company id, a well-formed id for a company that exists but
 * this user has no membership in, and a well-formed id for a company that
 * doesn't exist at all all produce the exact same 403 response — see
 * denyAccess() above.
 */
export const requireCompanyAccess = asyncHandler(async (req: Request, res: Response, next) => {
  const requestedCompanyId = req.params.companyId;

  if (!requestedCompanyId || !UUID_RE.test(requestedCompanyId)) {
    denyAccess(res);
    return;
  }

  // company_memberships has row-level security (see 0017): its SELECT
  // policy is defined in terms of the app.current_user_id session GUC, not
  // a bare user_id column comparison, so this lookup must run through
  // withTenantContext (which sets that GUC) rather than the plain pool —
  // otherwise the RLS policy sees no session context at all and silently
  // returns zero rows for every request, denying legitimate access along
  // with everything else.
  const result = await withTenantContext({ userId: req.userId! }, (client) =>
    client.query<{ company_id: string }>(
      `SELECT company_id FROM company_memberships
       WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.userId, requestedCompanyId]
    )
  );

  if (result.rows.length === 0) {
    denyAccess(res);
    return;
  }

  req.companyId = requestedCompanyId;
  next();
});

/**
 * Platform administration is checked from a flag on the users table that
 * is orthogonal to, and never derived from, any company_memberships or
 * user_roles row. A company Owner/Admin — no matter how privileged within
 * their own company — has is_platform_admin = false and will always be
 * denied here. See db/migrations/0016 and docs/multi-tenant-security.md.
 *
 * Synchronous (no DB call — req.isPlatformAdmin was already populated by
 * requireAuth), so no asyncHandler wrapper is needed here.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: () => void): void {
  if (!req.isPlatformAdmin) {
    denyAccess(res);
    return;
  }
  next();
}
