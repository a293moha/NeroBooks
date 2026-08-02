import { Pool } from "pg";
import { config, isProduction } from "../config.js";

// Neon (and most managed Postgres hosts) require TLS and present a
// cert chain node's default CA bundle doesn't have, so verification is
// relaxed rather than disabled outright -- this still encrypts the
// connection, it just doesn't pin the CA. Local dev Postgres has no TLS
// listener at all, hence the prod-only gate.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
});
