import jwt from "jsonwebtoken";
import { config } from "../config.js";

/**
 * The session token carries only the user's id — nothing about which
 * company they're currently acting within. Company access is re-verified
 * from the database on every request (see auth/middleware.ts), so there is
 * no "current company" claim here that could go stale or be trusted
 * blindly after a membership is suspended.
 */
export interface SessionPayload {
  userId: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === "object" && decoded && typeof decoded.userId === "string") {
      return { userId: decoded.userId };
    }
    return null;
  } catch {
    return null;
  }
}
