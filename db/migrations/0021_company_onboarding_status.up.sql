-- 0021_company_onboarding_status
--
-- Self-service signup (the "Buy now" flow) is being wired to actually
-- create a company via POST /api/me/onboarding (see
-- server/src/routes/memberships.routes.ts). createCompanyWithOwner
-- provisions everything a company needs synchronously in one transaction,
-- so there is no multi-step wizard state to track yet -- this column
-- exists so the API surface and future onboarding steps (e.g. "finish
-- setting up your chart of accounts") have somewhere real to record
-- progress, without a schema change at that point.

ALTER TABLE companies
  ADD COLUMN onboarding_status text NOT NULL DEFAULT 'complete'
    CHECK (onboarding_status IN ('pending', 'complete'));

COMMENT ON COLUMN companies.onboarding_status IS
  'Always ''complete'' today -- createCompanyWithOwner fully provisions a company in one transaction, so there is no in-progress state yet. Reserved for a future multi-step onboarding wizard.';
