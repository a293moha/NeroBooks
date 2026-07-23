import { Router } from "express";
import { pool } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signSession } from "../auth/jwt.js";
import { config, isProduction } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSessionCookie(res: import("express").Response, userId: string): void {
  const token = signSession({ userId });
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

authRouter.post("/signup", asyncHandler(async (req, res) => {
  const { email, password, fullName } = req.body ?? {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  if (typeof fullName !== "string" || fullName.trim().length === 0) {
    res.status(400).json({ error: "Full name is required." });
    return;
  }

  const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
  if (existing.rows.length > 0) {
    // Same generic wording as an invalid-login response — never confirm
    // or deny that an email is already registered to a third party.
    res.status(400).json({ error: "Unable to create account with those details." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, status, email_verified_at)
       VALUES ($1, $2, 'active', NULL) RETURNING id`,
      [email, passwordHash]
    );
    const userId = userResult.rows[0].id;
    await client.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)", [userId, fullName.trim()]);
    await client.query("COMMIT");

    setSessionCookie(res, userId);
    res.status(201).json({ id: userId, email, fullName: fullName.trim() });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  const genericError = { error: "Invalid email or password." };

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json(genericError);
    return;
  }

  const result = await pool.query<{ id: string; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE email = $1 AND deleted_at IS NULL",
    [email]
  );
  const user = result.rows[0];

  // Always run bcrypt.compare, even when no user was found, against a
  // fixed dummy hash — this keeps login timing (and therefore what a
  // timing attack could learn about whether the email exists) roughly
  // constant regardless of whether the account exists.
  const hashToCheck = user?.password_hash ?? "$2a$12$000000000000000000000000000000000000000000000000000";
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!user || !passwordOk || user.status !== "active") {
    res.status(401).json(genericError);
    return;
  }

  await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  setSessionCookie(res, user.id);
  res.json({ id: user.id, email });
}));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(config.cookieName);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
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
}));
