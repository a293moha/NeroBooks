import { platformPool } from "../db/platformPool.js";

export const VALID_PLANS = ["easystart", "plus", "advanced"] as const;
export type Plan = (typeof VALID_PLANS)[number];

/**
 * The second trusted, narrowly-scoped call site for platformPool, alongside
 * routes/platform.routes.ts. company_subscriptions (0020) deliberately has
 * no INSERT/UPDATE policy for the ordinary nerobooks_app role -- a company
 * must never be able to grant itself a paid plan by writing this table
 * directly, even via a bug in tenant-scoped code. Self-service onboarding
 * needs to create exactly one subscription row per company, which is why
 * this exists as its own function rather than importing platformPool
 * straight into a company-scoped route.
 *
 * ON CONFLICT DO NOTHING makes this naturally idempotent and safe to call
 * on every onboarding attempt, including retries: the first call's plan
 * wins, a later call with a different plan value is silently ignored
 * rather than silently upgrading/downgrading a company without a real
 * payment/billing event behind it.
 */
export async function createInitialSubscription(
  companyId: string,
  plan: Plan,
  setByUserId: string
): Promise<void> {
  await platformPool.query(
    `INSERT INTO company_subscriptions (company_id, plan, set_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId, plan, setByUserId]
  );
}
