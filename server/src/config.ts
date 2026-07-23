import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// NODE_ENV must be set in the process environment *before* this module
// loads (e.g. `NODE_ENV=test node ...`, which is exactly what
// package.json's "test" script does) — dotenv itself can't decide which
// file to read before it knows which environment it's in.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  platformDatabaseUrl: required("PLATFORM_DATABASE_URL"),
  // auth0Domain is inert in test mode (see auth/middleware.ts, which uses a
  // local test keypair instead of a real Auth0 tenant) but still required
  // so config.ts doesn't need env-specific branching -- .env.test just sets
  // it to a placeholder.
  auth0Domain: required("AUTH0_DOMAIN"),
  auth0Audience: required("AUTH0_AUDIENCE"),
  // A *different* Auth0 application from the SPA: a Machine-to-Machine
  // app authorized for Auth0's own Management API, used only by
  // routes/platform.routes.ts to provision new customers by email. Has a
  // real client secret (unlike the SPA's public client id) -- never
  // exposed to the frontend.
  auth0ManagementClientId: required("AUTH0_MANAGEMENT_CLIENT_ID"),
  auth0ManagementClientSecret: required("AUTH0_MANAGEMENT_CLIENT_SECRET"),
  // Where a newly-registered customer lands after setting their password
  // via the ticket link platform.routes.ts generates.
  primaryFrontendUrl: process.env.PRIMARY_FRONTEND_URL ?? "http://localhost:5173",
  storageRoot: process.env.STORAGE_ROOT ?? fileURLToPath(new URL("../storage-data", import.meta.url)),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Comma-separated list: the SPA is served from more than one origin at
  // once (a custom domain and GitHub Pages), plus localhost for dev.
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export const isProduction = config.nodeEnv === "production";
