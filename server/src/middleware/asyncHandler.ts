import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not automatically forward a rejected promise from an
 * async route handler to the error-handling middleware — an uncaught
 * rejection in a bare `async (req, res) => {...}` handler just hangs the
 * request instead of reaching errorHandler.ts. Every async handler in this
 * codebase is wrapped with this so a thrown error (a DB error, an RLS
 * violation bubbling up, anything) always reaches the generic error
 * handler rather than ever risking a raw stack trace/timeout being the
 * client-visible behavior.
 */
export function asyncHandler<T = void>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
