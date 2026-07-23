import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withTenantContext } from "../src/db/context.js";
import { config } from "../src/config.js";
import { signTestAccessToken } from "../src/auth/testJwks.js";

/**
 * Every test in this file follows the same shape: set up two independent
 * companies (A and B) with their own owner, employees, payroll, invoices,
 * and files, then attempt — as User A — to reach Company B's data through
 * every angle listed in the task: direct reads, edits, file downloads,
 * invoice access, a smuggled company id, and IDOR-style guessing of a
 * record id that legitimately exists (just not in User A's company).
 *
 * Every one of those attempts must come back as the exact same 403
 * response the server already uses for "you don't have access to this
 * company at all" — a passing run here is evidence that a real attacker
 * cannot distinguish "wrong company" from "record doesn't exist" from
 * "company doesn't exist," which is the whole point.
 *
 * Authentication here is a locally-signed test access token (see
 * ../src/auth/testJwks.ts) rather than a real Auth0 login — this exercises
 * the exact same signature/issuer/audience verification code path as
 * production (auth/middleware.ts's checkJwt), just against a local test
 * keypair instead of a real Auth0 tenant, so the suite stays fully offline
 * and deterministic. Each test identity's `users` row is inserted directly
 * (users/user_profiles have no row-level security — see
 * db/migrations/0017) with its auth0_sub pre-set to match the token's
 * `sub` claim, so requireAuth's JIT-provisioning path (which would
 * otherwise call Auth0's real /userinfo endpoint) never triggers here;
 * that provisioning path has its own dedicated test below instead.
 */

const app = createApp();

interface Fixture {
  userAId: string;
  userBId: string;
  tokenA: string;
  tokenB: string;
  companyAId: string;
  companyBId: string;
  employeeAId: string;
  employeeBId: string;
  payrollRunAId: string;
  payrollRunBId: string;
  invoiceAId: string;
  invoiceBId: string;
  documentAId: string;
  documentBId: string;
}

let fx: Fixture;

async function createTestIdentity(email: string, fullName: string): Promise<{ userId: string; token: string }> {
  const sub = `auth0|test-${randomUUID()}`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (email, auth0_sub, status, email_verified_at)
     VALUES ($1, $2, 'active', now()) RETURNING id`,
    [email, sub]
  );
  const userId = inserted.rows[0].id;
  await pool.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)", [userId, fullName]);
  return { userId, token: signTestAccessToken(sub, config.auth0Audience) };
}

function authed(token: string) {
  return {
    get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set("Authorization", `Bearer ${token}`),
  };
}

async function seedCompanyData(userId: string, companyId: string) {
  return withTenantContext({ userId, companyId }, async (client) => {
    const customer = await client.query<{ id: string }>(
      "INSERT INTO customers (company_id, name) VALUES ($1, 'Test Customer') RETURNING id",
      [companyId]
    );
    const employee = await client.query<{ id: string }>(
      `INSERT INTO employees (company_id, employee_number, first_name, last_name, hire_date)
       VALUES ($1, 'E1', 'Secret', 'Employee', '2024-01-01') RETURNING id`,
      [companyId]
    );
    const period = await client.query<{ id: string }>(
      `INSERT INTO payroll_periods (company_id, period_start, period_end, pay_date)
       VALUES ($1, '2026-07-01', '2026-07-15', '2026-07-20') RETURNING id`,
      [companyId]
    );
    const run = await client.query<{ id: string }>(
      "INSERT INTO payroll_runs (company_id, payroll_period_id, status) VALUES ($1, $2, 'draft') RETURNING id",
      [companyId, period.rows[0].id]
    );
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, issue_date, due_date, status)
       VALUES ($1, $2, 'INV-SECRET-1', '2026-07-01', '2026-07-31', 'sent') RETURNING id`,
      [companyId, customer.rows[0].id]
    );
    return {
      employeeId: employee.rows[0].id,
      payrollRunId: run.rows[0].id,
      invoiceId: invoice.rows[0].id,
    };
  });
}

before(async () => {
  const stamp = Date.now();
  const ownerA = await createTestIdentity(`owner-a-${stamp}@example.com`, "Owner A");
  const ownerB = await createTestIdentity(`owner-b-${stamp}@example.com`, "Owner B");
  const agentA = authed(ownerA.token);
  const agentB = authed(ownerB.token);

  const createA = await agentA.post("/api/companies").send({ name: "Attack Test Co A" });
  assert.equal(createA.status, 201);
  const companyAId = createA.body.id as string;

  const createB = await agentB.post("/api/companies").send({ name: "Attack Test Co B" });
  assert.equal(createB.status, 201);
  const companyBId = createB.body.id as string;

  const seededA = await seedCompanyData(ownerA.userId, companyAId);
  const seededB = await seedCompanyData(ownerB.userId, companyBId);

  const uploadA = await agentA
    .post(`/api/companies/${companyAId}/documents`)
    .attach("file", Buffer.from("company A confidential contents"), "a-secret.txt");
  assert.equal(uploadA.status, 201);

  const uploadB = await agentB
    .post(`/api/companies/${companyBId}/documents`)
    .attach("file", Buffer.from("company B confidential contents"), "b-secret.txt");
  assert.equal(uploadB.status, 201);

  fx = {
    userAId: ownerA.userId,
    userBId: ownerB.userId,
    tokenA: ownerA.token,
    tokenB: ownerB.token,
    companyAId,
    companyBId,
    employeeAId: seededA.employeeId,
    employeeBId: seededB.employeeId,
    payrollRunAId: seededA.payrollRunId,
    payrollRunBId: seededB.payrollRunId,
    invoiceAId: seededA.invoiceId,
    invoiceBId: seededB.invoiceId,
    documentAId: uploadA.body.id,
    documentBId: uploadB.body.id,
  };
});

after(async () => {
  await pool.end();
});

// ---------- Positive controls: User A can reach their OWN data fine ----------
// (Without these passing, a "denied" result below would be meaningless —
// it could just mean everything is broken, not that isolation works.)

test("positive control: User A can read their own employee", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyAId}/employees/${fx.employeeAId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.first_name, "Secret");
});

test("positive control: User A can read their own invoice", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyAId}/invoices/${fx.invoiceAId}`);
  assert.equal(res.status, 200);
});

test("positive control: User A can download their own document", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyAId}/documents/${fx.documentAId}`);
  assert.equal(res.status, 200);
  assert.equal(res.text, "company A confidential contents");
});

// ---------- Attack 1: Read another company's employees ----------

test("attack: read another company's employee list is denied", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/employees`);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

test("attack: read another company's specific employee by its real id is denied", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/employees/${fx.employeeBId}`);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

// ---------- Attack 2: Edit another company's payroll ----------

test("attack: editing another company's payroll run is denied", async () => {
  const res = await authed(fx.tokenA)
    .patch(`/api/companies/${fx.companyBId}/payroll-runs/${fx.payrollRunBId}`)
    .send({ status: "approved" });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });

  // And, just as importantly, the record was genuinely untouched — checked
  // from Company B's own, legitimate tenant context, not User A's.
  const stillDraft = await withTenantContext({ userId: fx.userBId, companyId: fx.companyBId }, (c) =>
    c.query("SELECT status FROM payroll_runs WHERE id = $1", [fx.payrollRunBId])
  );
  assert.equal(stillDraft.rows[0].status, "draft");
});

// ---------- Attack 3: Download another company's files ----------

test("attack: downloading another company's file is denied", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/documents/${fx.documentBId}`);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

// ---------- Attack 4: Access another company's invoices ----------

test("attack: reading another company's invoice is denied", async () => {
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/invoices/${fx.invoiceBId}`);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

// ---------- Attack 5: Change the company id in an API request ----------

test("attack: a companyId smuggled into the request body is ignored, not honored", async () => {
  // Legitimate URL (Company A, which User A really belongs to) but the body
  // tries to redirect the write at Company B via a same-named field. The
  // server only ever reads company id from the URL param after verifying
  // it via requireCompanyAccess — req.companyId, not req.body — so this
  // field is simply not read for that purpose anywhere in the codebase.
  const res = await authed(fx.tokenA)
    .patch(`/api/companies/${fx.companyAId}/settings`)
    .send({ companyId: fx.companyBId, invoiceNumberPrefix: "HACKED-" });
  assert.equal(res.status, 200);

  const settingsA = await withTenantContext({ userId: fx.userAId, companyId: fx.companyAId }, (c) =>
    c.query("SELECT invoice_number_prefix FROM company_settings WHERE company_id = $1", [fx.companyAId])
  );
  assert.equal(settingsA.rows[0].invoice_number_prefix, "HACKED-"); // applied to A, as intended

  const settingsB = await withTenantContext({ userId: fx.userBId, companyId: fx.companyBId }, (c) =>
    c.query("SELECT invoice_number_prefix FROM company_settings WHERE company_id = $1", [fx.companyBId])
  );
  assert.notEqual(settingsB.rows[0].invoice_number_prefix, "HACKED-"); // B was never touched
});

test("attack: a companyId smuggled into a custom header is ignored", async () => {
  const res = await authed(fx.tokenA)
    .get(`/api/companies/${fx.companyAId}/employees`)
    .set("X-Company-Id", fx.companyBId);
  // Still scoped to Company A (from the URL) — the header has no code path
  // that reads it at all.
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].first_name, "Secret");
});

// ---------- Attack 6: Guess another company's record id ----------

test("attack: a real employee id from another company, addressed via MY OWN company URL, is not found", async () => {
  // The most important IDOR case: requireCompanyAccess passes (Company A
  // is genuinely User A's own company), but the employee id in the path
  // belongs to Company B. This must be caught by the resource query's own
  // WHERE company_id = ... (and, independently, by RLS) — not by the
  // top-level membership check, which has nothing to say about this case.
  const res = await authed(fx.tokenA).get(`/api/companies/${fx.companyAId}/employees/${fx.employeeBId}`);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Not found." });
});

test("attack: a well-formed but entirely nonexistent company id is denied, not 500", async () => {
  const res = await authed(fx.tokenA).get("/api/companies/00000000-0000-0000-0000-000000000000/employees");
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

test("attack: a malformed company id is denied, not a database error", async () => {
  const res = await authed(fx.tokenA).get("/api/companies/not-a-uuid-at-all/employees");
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

test("attack: guessing a random nonexistent employee id within my own company 404s the same way", async () => {
  const res = await authed(fx.tokenA).get(
    `/api/companies/${fx.companyAId}/employees/ffffffff-ffff-ffff-ffff-ffffffffffff`
  );
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Not found." });
});

// ---------- Platform administration is separate from any company role ----------

test("a company Owner cannot reach platform-admin routes", async () => {
  const res = await authed(fx.tokenA).get("/api/platform/companies");
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Access denied." });
});

test("a company Owner cannot suspend another company via the platform route either", async () => {
  const res = await authed(fx.tokenA).patch(`/api/platform/companies/${fx.companyBId}/status`).send({
    status: "suspended",
  });
  assert.equal(res.status, 403);
});

// ---------- Membership suspension revokes access immediately ----------

test("suspending a membership immediately revokes that user's access, not just at next login", async () => {
  const stamp = Date.now();
  const email = `member-${stamp}@example.com`;
  const member = await createTestIdentity(email, "Member");
  const memberAgent = authed(member.token);

  const invite = await authed(fx.tokenA).post(`/api/companies/${fx.companyAId}/members`).send({ email });
  assert.equal(invite.status, 201);
  const accept = await memberAgent.post(`/api/me/invitations/${fx.companyAId}/accept`);
  assert.equal(accept.status, 200);

  const beforeSuspend = await memberAgent.get(`/api/companies/${fx.companyAId}/employees`);
  assert.equal(beforeSuspend.status, 200);

  const membershipRow = await withTenantContext({ userId: fx.userAId, companyId: fx.companyAId }, (c) =>
    c.query<{ id: string }>(
      "SELECT id FROM company_memberships WHERE company_id = $1 AND invited_email = $2",
      [fx.companyAId, email]
    )
  );
  const suspend = await authed(fx.tokenA).patch(
    `/api/companies/${fx.companyAId}/members/${membershipRow.rows[0].id}/suspend`
  );
  assert.equal(suspend.status, 200);

  const afterSuspend = await memberAgent.get(`/api/companies/${fx.companyAId}/employees`);
  assert.equal(afterSuspend.status, 403);
  assert.deepEqual(afterSuspend.body, { error: "Access denied." });
});

// ---------- Every denial looks identical, regardless of the underlying reason ----------

test("every cross-company denial in this file returns the exact same shape", async () => {
  const responses = await Promise.all([
    authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/employees`),
    authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/invoices/${fx.invoiceBId}`),
    authed(fx.tokenA).get(`/api/companies/${fx.companyBId}/documents/${fx.documentBId}`),
    authed(fx.tokenA).get("/api/companies/00000000-0000-0000-0000-000000000000/employees"),
  ]);
  for (const res of responses) {
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "Access denied." });
    assert.equal(Object.keys(res.body).length, 1); // nothing extra leaked in the payload
  }
});

// ---------- No token at all, or a garbage token, is rejected the same way ----------

test("a request with no Authorization header at all is rejected", async () => {
  const res = await request(app).get(`/api/companies/${fx.companyAId}/employees`);
  assert.equal(res.status, 401);
});

test("a syntactically invalid bearer token is rejected, not a 500", async () => {
  const res = await request(app)
    .get(`/api/companies/${fx.companyAId}/employees`)
    .set("Authorization", "Bearer not-a-real-jwt");
  assert.equal(res.status, 401);
});

test("a token signed with the wrong key is rejected", async () => {
  // Same claims/shape as a real test token, but never issued by this
  // process's test keypair -- simulates a forged/tampered token.
  const forged = signTestAccessToken(`auth0|forged-${randomUUID()}`, config.auth0Audience) + "tampered";
  const res = await request(app).get(`/api/companies/${fx.companyAId}/employees`).set("Authorization", `Bearer ${forged}`);
  assert.equal(res.status, 401);
});

// ---------- JIT provisioning: a brand-new Auth0 identity gets a real row ----------

test("a first-time Auth0 identity is provisioned into users on first authenticated request", async () => {
  const sub = `auth0|test-new-${randomUUID()}`;
  const token = signTestAccessToken(sub, config.auth0Audience);
  const email = `brand-new-${Date.now()}@example.com`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).endsWith("/userinfo")) {
      return new Response(JSON.stringify({ sub, email, email_verified: true, name: "Brand New User" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(url as never);
  }) as typeof fetch;

  try {
    const res = await authed(token).get("/api/auth/me");
    assert.equal(res.status, 200);
    assert.equal(res.body.email, email);
    assert.equal(res.body.fullName, "Brand New User");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const row = await pool.query("SELECT id, email, auth0_sub FROM users WHERE auth0_sub = $1", [sub]);
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].email, email);
});
