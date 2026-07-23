import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.routes.js";
import { companiesRouter } from "./routes/companies.routes.js";
import { meRouter, membersRouter } from "./routes/memberships.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { platformRouter } from "./routes/platform.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

/**
 * Exported as a factory (rather than started at module scope) specifically
 * so the test suite (server/tests/) can import a fully-wired app and drive
 * it with supertest without binding a network port — see
 * server/tests/multi-tenant-security.test.ts.
 */
export function createApp() {
  const app = express();

  // Auth is a Bearer access token (Auth0), not a cookie, so credentials:
  // true / cookie-parser are no longer needed here at all.
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/companies", companiesRouter);
  app.use("/api/companies/:companyId/members", membersRouter);
  app.use("/api/companies/:companyId", resourcesRouter);
  app.use("/api/platform", platformRouter);

  app.use(errorHandler);

  return app;
}
