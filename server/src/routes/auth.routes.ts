import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Identity itself (signup, login, logout, password reset) is entirely
 * Auth0's responsibility now — the frontend talks to Auth0 directly for
 * all of that. This router only ever exposes what our own database knows
 * about the caller, resolved from the verified Auth0 access token by
 * requireAuth (see auth/middleware.ts).
 */
export const authRouter = Router();

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query<{ email: string; full_name: string; is_platform_admin: boolean }>(
      `SELECT u.email, p.full_name, u.is_platform_admin
     FROM users u JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
      [req.userId]
    );
    const me = result.rows[0];
    if (!me) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ id: req.userId, email: me.email, fullName: me.full_name, isPlatformAdmin: me.is_platform_admin });
  })
);
