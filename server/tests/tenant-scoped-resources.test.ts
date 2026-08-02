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
 * Covers the customers/invoices/expenses CRUD surface added on top of the
 * existing employees/payroll/documents coverage in
 * multi-tenant-security.test.ts, plus the self-service onboarding endpoint
 * (POST /api/me/onboarding). Same fixture shape as that file (two
 * independent companies, A and B) and the same rule: every cross-company
 * attempt must come back exactly the same 403/404 the rest of the app
 * already uses, and a real record from another company addressed by id
 * must never be visible, editable, or deletable through my own company's
 * URL.
 */

const app = createApp();

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
    delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

interface CompanyFixture {
  ownerId: string;
  token: string;
  companyId: string;
  customerId: string;
  invoiceId: string;
  expenseId: string;
}

async function buildCompanyFixture(label: string): Promise<CompanyFixture> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = await createTestIdentity(`owner-${label}-${stamp}@example.com`, `Owner ${label}`);
  const agent = authed(owner.token);

  const createCompany = await agent.post("/api/companies").send({ name: `${label} Co ${stamp}` });
  assert.equal(createCompany.status, 201);
  const companyId = createCompany.body.id as string;

  const createCustomer = await agent
    .post(`/api/companies/${companyId}/customers`)
    .send({ name: `${label} Customer`, email: `customer-${stamp}@example.com` });
  assert.equal(createCustomer.status, 201);
  const customerId = createCustomer.body.id as string;

  const createInvoice = await agent.post(`/api/companies/${companyId}/invoices`).send({
    customerId,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    lineItems: [{ description: `${label} secret line item`, quantity: 2, unitPrice: 100 }],
  });
  assert.equal(createInvoice.status, 201);
  const invoiceId = createInvoice.body.id as string;

  const createExpense = await agent.post(`/api/companies/${companyId}/expenses`).send({
    date: "2026-08-01",
    category: "Software",
    amount: 42,
    memo: `${label} secret expense`,
  });
  assert.equal(createExpense.status, 201);
  const expenseId = createExpense.body.id as string;

  return { ownerId: owner.userId, token: owner.token, companyId, customerId, invoiceId, expenseId };
}

let a: CompanyFixture;
let b: CompanyFixture;

before(async () => {
  a = await buildCompanyFixture("A");
  b = await buildCompanyFixture("B");
});

after(async () => {
  await pool.end();
});

// ---------- Positive controls ----------

test("positive control: Owner A can list, read, and update their own customer", async () => {
  const list = await authed(a.token).get(`/api/companies/${a.companyId}/customers`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);

  const detail = await authed(a.token).get(`/api/companies/${a.companyId}/customers/${a.customerId}`);
  assert.equal(detail.status, 200);

  const updated = await authed(a.token)
    .patch(`/api/companies/${a.companyId}/customers/${a.customerId}`)
    .send({ phone: "555-0100" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.phone, "555-0100");
});

test("positive control: Owner A can list and read their own invoice and expense", async () => {
  const invoices = await authed(a.token).get(`/api/companies/${a.companyId}/invoices`);
  assert.equal(invoices.status, 200);
  assert.equal(invoices.body.length, 1);

  const expenses = await authed(a.token).get(`/api/companies/${a.companyId}/expenses`);
  assert.equal(expenses.status, 200);
  assert.equal(expenses.body.length, 1);
});

// ---------- Cross-company denial: list ----------

test("attack: User A cannot list Company B's customers/invoices/expenses", async () => {
  const results = await Promise.all([
    authed(a.token).get(`/api/companies/${b.companyId}/customers`),
    authed(a.token).get(`/api/companies/${b.companyId}/invoices`),
    authed(a.token).get(`/api/companies/${b.companyId}/expenses`),
  ]);
  for (const res of results) {
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "Access denied." });
  }
});

// ---------- Cross-company denial: IDOR (real id, wrong company) ----------

test("attack: User A cannot retrieve Company B's records by guessing/reusing real ids under B's own URL", async () => {
  const results = await Promise.all([
    authed(a.token).get(`/api/companies/${b.companyId}/customers/${b.customerId}`),
    authed(a.token).get(`/api/companies/${b.companyId}/invoices/${b.invoiceId}`),
    authed(a.token).get(`/api/companies/${b.companyId}/expenses/${b.expenseId}`),
  ]);
  for (const res of results) {
    assert.equal(res.status, 403); // denied at the membership check before the record lookup even runs
  }
});

test("attack: a real Company B record id addressed through Company A's own URL 404s, not 200", async () => {
  const results = await Promise.all([
    authed(a.token).get(`/api/companies/${a.companyId}/customers/${b.customerId}`),
    authed(a.token).get(`/api/companies/${a.companyId}/invoices/${b.invoiceId}`),
    authed(a.token).get(`/api/companies/${a.companyId}/expenses/${b.expenseId}`),
  ]);
  for (const res of results) {
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found." });
  }
});

// ---------- Cross-company denial: update ----------

test("attack: User A cannot update Company B's customer via B's own URL", async () => {
  const res = await authed(a.token)
    .patch(`/api/companies/${b.companyId}/customers/${b.customerId}`)
    .send({ phone: "HACKED" });
  assert.equal(res.status, 403);

  const stillOriginal = await withTenantContext({ userId: b.ownerId, companyId: b.companyId }, (c) =>
    c.query("SELECT phone FROM customers WHERE id = $1", [b.customerId])
  );
  assert.notEqual(stillOriginal.rows[0].phone, "HACKED");
});

test("attack: a Company B record id addressed through Company A's own URL is not found, not updated", async () => {
  const res = await authed(a.token)
    .patch(`/api/companies/${a.companyId}/customers/${b.customerId}`)
    .send({ phone: "HACKED" });
  assert.equal(res.status, 404);
});

// ---------- Cross-company denial: delete ----------

test("attack: User A cannot delete Company B's customer, invoice, or expense", async () => {
  const results = await Promise.all([
    authed(a.token).delete(`/api/companies/${b.companyId}/customers/${b.customerId}`),
    authed(a.token).delete(`/api/companies/${b.companyId}/invoices/${b.invoiceId}`),
    authed(a.token).delete(`/api/companies/${b.companyId}/expenses/${b.expenseId}`),
  ]);
  for (const res of results) {
    assert.equal(res.status, 403);
  }

  // Confirmed genuinely untouched, from B's own legitimate context.
  const stillThere = await withTenantContext({ userId: b.ownerId, companyId: b.companyId }, (c) =>
    c.query("SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL", [b.customerId])
  );
  assert.equal(stillThere.rows.length, 1);
});

// ---------- Changing companyId in the request body does not bypass isolation ----------

test("attack: creating an invoice for a customer that belongs to a different company is rejected", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/invoices`).send({
    customerId: b.customerId, // real customer id, but it's Company B's
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    lineItems: [{ description: "Should never be created", quantity: 1, unitPrice: 1 }],
  });
  assert.equal(res.status, 422);
});

test("attack: a companyId field smuggled into a customer-update body is not read for scoping", async () => {
  const res = await authed(a.token)
    .patch(`/api/companies/${a.companyId}/customers/${a.customerId}`)
    .send({ companyId: b.companyId, phone: "555-9999" });
  assert.equal(res.status, 200); // applied to A, as intended, since the URL is genuinely A's own
  assert.equal(res.body.company_id, a.companyId);
});

// ---------- Unauthenticated / unauthorized ----------

test("requests to the new resource routes without a token are rejected", async () => {
  const results = await Promise.all([
    request(app).get(`/api/companies/${a.companyId}/customers`),
    request(app).get(`/api/companies/${a.companyId}/invoices`),
    request(app).get(`/api/companies/${a.companyId}/expenses`),
  ]);
  for (const res of results) {
    assert.equal(res.status, 401);
  }
});

// ---------- Self-service onboarding ----------

test("onboarding: a brand-new user with no company gets a real, empty company", async () => {
  const stamp = Date.now();
  const user = await createTestIdentity(`onboard-${stamp}@example.com`, "New Owner");
  const agent = authed(user.token);

  const res = await agent.post("/api/me/onboarding").send({ companyName: "Fresh Co", plan: "plus" });
  assert.equal(res.status, 201);
  assert.equal(res.body.created, true);
  const companyId = res.body.companyId as string;

  const customers = await agent.get(`/api/companies/${companyId}/customers`);
  assert.equal(customers.status, 200);
  assert.deepEqual(customers.body, []);

  const invoices = await agent.get(`/api/companies/${companyId}/invoices`);
  assert.deepEqual(invoices.body, []);

  const expenses = await agent.get(`/api/companies/${companyId}/expenses`);
  assert.deepEqual(expenses.body, []);

  const subscription = await withTenantContext({ userId: user.userId, companyId }, (c) =>
    c.query("SELECT plan FROM company_subscriptions WHERE company_id = $1", [companyId])
  );
  assert.equal(subscription.rows[0].plan, "plus");
});

test("onboarding: a duplicate/retried request does not create a second company, membership, or subscription", async () => {
  const stamp = Date.now();
  const user = await createTestIdentity(`onboard-dup-${stamp}@example.com`, "Retry Owner");
  const agent = authed(user.token);

  const first = await agent.post("/api/me/onboarding").send({ companyName: "First Try Co", plan: "easystart" });
  assert.equal(first.status, 201);
  assert.equal(first.body.created, true);

  // Retried with different data, simulating a double-submit or a client
  // that resent the request after a network blip -- must not create a
  // second company, and must not silently change the plan already set.
  const second = await agent.post("/api/me/onboarding").send({ companyName: "Second Try Co", plan: "advanced" });
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.companyId, first.body.companyId);

  const memberships = await withTenantContext({ userId: user.userId, companyId: first.body.companyId }, (c) =>
    c.query("SELECT company_id FROM company_memberships WHERE user_id = $1 AND status = 'active'", [user.userId])
  );
  assert.equal(memberships.rows.length, 1);

  const subscriptions = await withTenantContext({ userId: user.userId, companyId: first.body.companyId }, (c) =>
    c.query("SELECT plan FROM company_subscriptions WHERE company_id = $1", [first.body.companyId])
  );
  assert.equal(subscriptions.rows.length, 1);
  assert.equal(subscriptions.rows[0].plan, "easystart"); // first write wins, never silently upgraded
});
