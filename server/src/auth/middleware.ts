import type { Request, Response, NextFunction } from "express";
import { auth as authenticateJwt } from "express-oauth2-jwt-bearer";
import { pool } from "../db/pool.js";
import { withTenantContext } from "../db/context.js";
import { config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { platformPool } from "../db/platformPool.js";

// TEMPORARY diagnostic aid, see routes/memberships.routes.ts's debugMark
// for context. Remove once root-caused.
async function debugMark(stage: string, extra?: string): Promise<void> {
  try {
    await platformPool.query("INSERT INTO audit_logs (company_id, actor_user_id, action) VALUES (NULL, NULL, $1)", [
      `debug.requireAuth.${stage}${extra ? `:${extra}` : ""}`,
    ]);
  } catch {
    // never let diagnostics break the real request
  }
}

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
 * Verifies the Auth0 access token's signature, issuer, audience, and
 * expiry. In every environment except test, this fetches Auth0's real JWKS
 * over HTTPS (cached by the library) and checks against it. In test mode,
 * it trusts a local, freshly-generated keypair instead (see testJwks.ts) so
 * the suite never depends on network access or a real Auth0 tenant, while
 * still exercising this exact verification code path.
 */
const checkJwt =
  config.nodeEnv === "test"
    ? await (async () => {
        const { TEST_ISSUER, testJwk } = await import("./testJwks.js");
        return authenticateJwt({
          issuer: TEST_ISSUER,
          audience: config.auth0Audience,
          publicKey: { keys: [testJwk] },
          tokenSigningAlg: "RS256",
        });
      })()
    : authenticateJwt({
        issuerBaseURL: `https://${config.auth0Domain}/`,
        audience: config.auth0Audience,
      });

function runCheckJwt(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    checkJwt(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

interface Auth0UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

async function fetchAuth0UserInfo(accessToken: string): Promise<Auth0UserInfo> {
  const response = await fetch(`https://${config.auth0Domain}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Auth0 /userinfo request failed with status ${response.status}`);
  }
  return (await response.json()) as Auth0UserInfo;
}

interface ProvisionedUser {
  id: string;
  status: string;
  is_platform_admin: boolean;
}

/**
 * The first time a given Auth0 identity (its "sub" claim) is seen, this
 * creates — or, if a pre-existing row happens to share the same email,
 * links to — a row in our own `users` table. Every other table
 * (company_memberships, RLS policies, audit logs, ...) keys off
 * `users.id`, never off Auth0's sub directly, so this is the one place
 * that translates a verified external identity into an internal one.
 *
 * Access tokens scoped to a custom API audience don't carry email/name by
 * default, so this calls Auth0's standard /userinfo endpoint (using the
 * same bearer token that was already verified by checkJwt) to get them —
 * ordinary OIDC, no extra Auth0 dashboard configuration required.
 */
async function provisionOrLinkUser(sub: string, accessToken: string): Promise<ProvisionedUser> {
  const info = await fetchAuth0UserInfo(accessToken);
  if (!info.email) {
    throw new Error("Auth0 /userinfo response did not include an email claim");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<ProvisionedUser & { auth0_sub: string | null }>(
      "SELECT id, status, is_platform_admin, auth0_sub FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE",
      [info.email]
    );
    let row = existing.rows[0];

    if (row && row.auth0_sub && row.auth0_sub !== sub) {
      throw new Error(`Email ${info.email} is already linked to a different Auth0 identity`);
    }

    if (row && !row.auth0_sub) {
      await client.query(
        "UPDATE users SET auth0_sub = $1, email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $3",
        [sub, info.email_verified ? new Date() : null, row.id]
      );
    } else if (!row) {
      const inserted = await client.query<ProvisionedUser>(
        `INSERT INTO users (email, auth0_sub, status, email_verified_at)
         VALUES ($1, $2, 'active', $3)
         RETURNING id, status, is_platform_admin`,
        [info.email, sub, info.email_verified ? new Date() : null]
      );
      row = { ...inserted.rows[0], auth0_sub: sub };
      await client.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)", [
        row.id,
        info.name?.trim() || info.email.split("@")[0],
      ]);
    }

    await client.query("COMMIT");
    return { id: row!.id, status: row!.status, is_platform_admin: row!.is_platform_admin };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifies the Auth0 access token, then resolves it to an internal
 * users.id — provisioning a new row on first sight of a given Auth0
 * identity. Also re-checks the user's status and is_platform_admin flag
 * from the database on every request (never just from the token), so a
 * suspended/deactivated account loses access immediately.
 */
export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  await debugMark("start", `${req.method} ${req.originalUrl}`);
  try {
    await runCheckJwt(req, res);
  } catch {
    await debugMark("checkjwt_failed", `${req.method} ${req.originalUrl}`);
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  await debugMark("checkjwt_ok", `${req.method} ${req.originalUrl}`);

  const sub = req.auth?.payload.sub;
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!sub || !accessToken) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const byExistingSub = await pool.query<ProvisionedUser>(
    "SELECT id, status, is_platform_admin FROM users WHERE auth0_sub = $1 AND deleted_at IS NULL",
    [sub]
  );

  const user = byExistingSub.rows[0] ?? (await provisionOrLinkUser(sub, accessToken));

  if (user.status !== "active") {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  req.userId = user.id;
  req.isPlatformAdmin = user.is_platform_admin;
  await debugMark("calling_next", `${req.method} ${req.originalUrl}`);
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
export const requireCompanyAccess = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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
