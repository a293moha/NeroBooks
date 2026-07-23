// Augments Express's Request type with the two fields every tenant-scoped
// route relies on. Both are set exclusively by auth/middleware.ts, after
// independent server-side verification — never copied from a client-
// supplied value without that check running first.
export {};

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth after verifying the session token AND re-checking the user is still active in the database. */
      userId?: string;
      /** Set by requireAuth. */
      isPlatformAdmin?: boolean;
      /** Set by requireCompanyAccess ONLY after confirming an active company_memberships row for (userId, companyId). This is the sole source of truth a route handler may use as "the current company" — never req.params/req.body/req.query directly. */
      companyId?: string;
    }
  }
}
