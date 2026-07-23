import { randomBytes } from "node:crypto";
import { config } from "../config.js";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/**
 * A client_credentials-flow token for Auth0's own Management API,
 * obtained using a dedicated Machine-to-Machine application (a separate
 * Auth0 application from the SPA and the NeroBooks API -- see
 * .env.example) that has a real client secret, unlike the SPA's public
 * client id. This must never be imported from anything reachable by a
 * regular company-scoped request; only routes/platform.routes.ts uses it,
 * consistent with how platformPool.ts is similarly restricted.
 */
async function getManagementToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const response = await fetch(`https://${config.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.auth0ManagementClientId,
      client_secret: config.auth0ManagementClientSecret,
      audience: `https://${config.auth0Domain}/api/v2/`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain an Auth0 Management API token (${response.status})`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

interface ProvisionedAuth0User {
  auth0Sub: string;
}

/**
 * Creates a user in Auth0's database connection with a random, never
 * communicated, immediately-discarded password, then relies on the caller
 * to issue a password-change ticket (see createPasswordSetupTicket) that
 * lets the real person set their own real password. This is Auth0's own
 * documented pattern for "an admin registers someone by email; they set
 * their own password via an emailed link" -- there is no way to create a
 * database-connection user with literally no password at all, so a
 * throwaway one is required to exist for the instant before the ticket
 * invalidates it. The throwaway value is discarded after this call
 * returns; it is never logged, stored, or reused.
 */
export async function provisionAuth0User(email: string): Promise<ProvisionedAuth0User> {
  const token = await getManagementToken();
  const throwawayPassword = `${randomBytes(24).toString("base64url")}!Aa1`;

  const response = await fetch(`https://${config.auth0Domain}/api/v2/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: throwawayPassword,
      connection: "Username-Password-Authentication",
      email_verified: false,
      verify_email: false,
    }),
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new Error("A user with that email already exists in Auth0.");
    }
    throw new Error(`Failed to create Auth0 user (${response.status})`);
  }

  const created = (await response.json()) as { user_id: string };
  return { auth0Sub: created.user_id };
}

/**
 * Issues a one-time link that lets the given Auth0 user set their own
 * password, then lands them back at resultUrl. Valid for 7 days.
 */
export async function createPasswordSetupTicket(auth0Sub: string, resultUrl: string): Promise<string> {
  const token = await getManagementToken();

  const response = await fetch(`https://${config.auth0Domain}/api/v2/tickets/password-change`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: auth0Sub,
      result_url: resultUrl,
      ttl_sec: 60 * 60 * 24 * 7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create a password-setup ticket (${response.status})`);
  }

  const data = (await response.json()) as { ticket: string };
  return data.ticket;
}
