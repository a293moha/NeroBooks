import type { PoolClient } from "pg";

export interface CreateCompanyOptions {
  companyId: string;
  ownerUserId: string;
  name: string;
  legalName?: string | null;
  defaultCurrency?: string;
  timezone?: string;
  countryCode?: string | null;
}

/**
 * Creates a company, its default settings row, and an active Owner
 * membership + role assignment for ownerUserId — the full definition of
 * "a fully set-up company," shared by both self-service company creation
 * (routes/companies.routes.ts) and platform-admin customer registration
 * (routes/platform.routes.ts) so the two paths can never drift apart on
 * what that means.
 *
 * Insert order matters and must not change: companies, then
 * company_settings, then company_memberships, then user_roles. The
 * membership row must exist before anything tries to SELECT the company
 * back through RLS's companies_select policy (which requires an active
 * membership) — see the caller in companies.routes.ts for why that
 * SELECT deliberately happens outside this function, after it returns.
 *
 * Does not COMMIT and does not write an audit entry — callers do both,
 * since they differ (self-service runs under withTenantContext and logs
 * `company.created`; platform admin runs under platformPool and logs
 * `platform.customer_registered`), and a shared audit action name would
 * blur that distinction.
 */
export async function createCompanyWithOwner(client: PoolClient, options: CreateCompanyOptions): Promise<void> {
  const { companyId, ownerUserId, name, legalName, defaultCurrency, timezone, countryCode } = options;

  await client.query(
    `INSERT INTO companies (id, name, legal_name, default_currency, timezone, country_code)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, name, legalName ?? null, defaultCurrency ?? "USD", timezone ?? "UTC", countryCode ?? null]
  );

  await client.query("INSERT INTO company_settings (company_id) VALUES ($1)", [companyId]);

  await client.query(
    `INSERT INTO company_memberships (company_id, user_id, invited_email, status, accepted_at)
     SELECT $1, $2, email, 'active', now() FROM users WHERE id = $2`,
    [companyId, ownerUserId]
  );

  await client.query(
    `INSERT INTO user_roles (company_id, user_id, role_id)
     SELECT $1, $2, id FROM roles WHERE name = 'Owner' AND company_id IS NULL`,
    [companyId, ownerUserId]
  );
}
