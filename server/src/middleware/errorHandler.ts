import type { NextFunction, Request, Response } from "express";

/**
 * The last middleware in the chain. Deliberately never forwards a raw
 * error message to the client — a Postgres RLS violation, a constraint
 * name, a stack trace, or a file path are all things an attacker can learn
 * from verbatim error text, and none of it is anything a legitimate client
 * needs to function. Full detail still goes to the server log.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong." });
}
