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
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  cookieName: "nerobooks_session",
  storageRoot: process.env.STORAGE_ROOT ?? fileURLToPath(new URL("../storage-data", import.meta.url)),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};

export const isProduction = config.nodeEnv === "production";
