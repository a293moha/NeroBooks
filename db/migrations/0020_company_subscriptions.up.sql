-- 0020_company_subscriptions
-- Tracks which pricing tier a company is actually on, as a real backend
-- fact. Until now "plan" existed only as a client-side preview toggle (see
-- src/context/AuthContext.tsx in the frontend), with nothing server-side
-- backing it at all -- anyone could claim any plan by editing browser
-- storage. This table is deliberately separate from company_settings:
-- billing state has different write rules (only a platform admin today;
-- eventually a Stripe webhook -- never the company itself) and a
-- different lifecycle than operational settings.

CREATE TABLE company_subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL UNIQUE REFERENCES companies (id) ON DELETE CASCADE,
  plan                    text NOT NULL CHECK (plan IN ('easystart', 'plus', 'advanced')),
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  set_by_user_id          uuid REFERENCES users (id),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_subscriptions IS
  'One row per company: which pricing tier it is on. Until real Stripe billing exists (see docs/backend-roadmap.md Phase 2), rows are written only by a platform administrator (routes/platform.routes.ts, via the BYPASSRLS platform pool) -- the RLS policy below deliberately grants this table no INSERT/UPDATE/DELETE policy at all for the ordinary app role, so nerobooks_app cannot write it under any circumstance. stripe_customer_id/stripe_subscription_id are reserved for that future integration and unused today.';
COMMENT ON COLUMN company_subscriptions.set_by_user_id IS
  'The platform admin who set this plan, for audit purposes. NULL only if ever set by an automated process (e.g. a future Stripe webhook).';

CREATE TRIGGER trg_company_subscriptions_set_updated_at
  BEFORE UPDATE ON company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read-only from the app role's perspective: a company can see its own
-- plan (useful for future feature-gating checks done server-side instead
-- of trusting the client), but has no path to writing it at all -- no
-- INSERT/UPDATE/DELETE policy is defined, and Postgres RLS denies by
-- default when no policy matches a command once RLS is enabled.
CREATE POLICY company_subscriptions_select ON company_subscriptions
  FOR SELECT
  USING (company_id = nullif(current_setting('app.current_company_id', true), '')::uuid);
