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

// Regression test: creating an invoice directly with status "sent" (the
// UI's "Save & send" button) used to 500 in production because the
// invoice_items immutability trigger (0010) rejects inserting line items
// against a non-draft invoice, and the create handler used to insert with
// status='sent' from the start, in the same transaction as the line
// items. buildCompanyFixture's own invoice above never caught this since
// it doesn't pass a status at all (defaults to draft).
test("creating an invoice with status 'sent' directly succeeds, with line items intact", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/invoices`).send({
    customerId: a.customerId,
    issueDate: "2026-08-02",
    dueDate: "2026-09-01",
    status: "sent",
    lineItems: [{ description: "10kgs of coffee", quantity: 10, unitPrice: 45000 }],
    currency: "USD",
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "sent");
  assert.equal(Number(res.body.total), 450000);

  const items = await authed(a.token).get(`/api/companies/${a.companyId}/invoices/${res.body.id}/items`);
  assert.equal(items.status, 200);
  assert.equal(items.body.length, 1);
  assert.equal(items.body[0].description, "10kgs of coffee");
});

// ---------- Invoice editing (0022: editable at any status) ----------

test("editing a draft invoice updates customer/dates/line items/total in place, without changing the invoice number", async () => {
  const before = await authed(a.token).get(`/api/companies/${a.companyId}/invoices/${a.invoiceId}`);
  assert.equal(before.status, 200);
  const originalNumber = before.body.invoice_number;
  assert.equal(before.body.last_edited_at, null);

  const edited = await authed(a.token).patch(`/api/companies/${a.companyId}/invoices/${a.invoiceId}`).send({
    customerId: a.customerId,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    lineItems: [{ description: "Edited line item", quantity: 3, unitPrice: 200 }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.invoice_number, originalNumber);
  assert.equal(Number(edited.body.total), 600);
  assert.ok(edited.body.last_edited_at, "last_edited_at should be stamped by the edit endpoint");
  assert.equal(edited.body.lineItems.length, 1);
  assert.equal(edited.body.lineItems[0].description, "Edited line item");
});

test("editing a Sent invoice's customer/line items and jumping status straight to Paid both succeed (warn-but-allow, not DB-blocked)", async () => {
  const created = await authed(a.token).post(`/api/companies/${a.companyId}/invoices`).send({
    customerId: a.customerId,
    issueDate: "2026-08-02",
    dueDate: "2026-09-01",
    status: "sent",
    lineItems: [{ description: "Original line item", quantity: 1, unitPrice: 1000 }],
  });
  assert.equal(created.status, 201);
  const invoiceId = created.body.id;
  const originalNumber = created.body.invoice_number;

  const edited = await authed(a.token).patch(`/api/companies/${a.companyId}/invoices/${invoiceId}`).send({
    customerId: a.customerId,
    issueDate: "2026-08-02",
    dueDate: "2026-09-01",
    status: "paid",
    lineItems: [{ description: "Corrected after sending", quantity: 2, unitPrice: 500 }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, "paid");
  assert.equal(edited.body.invoice_number, originalNumber);
  assert.equal(Number(edited.body.total), 1000);
  assert.equal(edited.body.lineItems[0].description, "Corrected after sending");

  const audit = await withTenantContext({ userId: a.ownerId, companyId: a.companyId }, (c) =>
    c.query(
      "SELECT before_data, after_data FROM audit_logs WHERE entity_type = 'invoice' AND entity_id = $1 AND action = 'invoice.updated' ORDER BY created_at DESC LIMIT 1",
      [invoiceId]
    )
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].before_data.status, "sent");
  assert.equal(audit.rows[0].after_data.status, "paid");
});

test("editing an invoice rejects a due date before the issue date and an unrecognized status", async () => {
  const badDates = await authed(a.token).patch(`/api/companies/${a.companyId}/invoices/${a.invoiceId}`).send({
    customerId: a.customerId,
    issueDate: "2026-08-31",
    dueDate: "2026-08-01",
    lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }],
  });
  assert.equal(badDates.status, 400);

  const badStatus = await authed(a.token).patch(`/api/companies/${a.companyId}/invoices/${a.invoiceId}`).send({
    customerId: a.customerId,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    status: "not_a_real_status",
    lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }],
  });
  assert.equal(badStatus.status, 400);
});

// ---------- Expense editing & history (0022: editable at any status) ----------

test("editing a pending expense updates vendor/category/date/amount/memo/payment method in place", async () => {
  const edited = await authed(a.token).patch(`/api/companies/${a.companyId}/expenses/${a.expenseId}`).send({
    date: "2026-08-03",
    category: "Travel",
    amount: 77,
    paymentMethod: "cash",
    memo: "Edited memo",
  });
  assert.equal(edited.status, 200);
  assert.equal(Number(edited.body.amount), 77);
  assert.equal(edited.body.payment_method, "cash");
  assert.equal(edited.body.memo, "Edited memo");
  assert.equal(edited.body.category, "Travel");
});

test("editing an already-approved expense still succeeds (warn-but-allow), and its history shows the before/after diff", async () => {
  const approve = await authed(a.token)
    .patch(`/api/companies/${a.companyId}/expenses/${a.expenseId}`)
    .send({ action: "approve" });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.status, "approved");

  const edited = await authed(a.token).patch(`/api/companies/${a.companyId}/expenses/${a.expenseId}`).send({
    amount: 50000,
  });
  assert.equal(edited.status, 200);
  assert.equal(Number(edited.body.amount), 50000);

  const history = await authed(a.token).get(`/api/companies/${a.companyId}/expenses/${a.expenseId}/history`);
  assert.equal(history.status, 200);
  assert.ok(history.body.length >= 3); // created, approved, amount-edited

  const created = history.body[0];
  assert.equal(created.action, "expense.created");
  assert.deepEqual(created.changes, []);

  const amountEdit = history.body[history.body.length - 1];
  assert.equal(amountEdit.action, "expense.updated");
  const amountChange = amountEdit.changes.find((c: { field: string }) => c.field === "amount");
  assert.ok(amountChange, "expected an amount change entry in history");
  assert.equal(Number(amountChange.to), 50000);
});

test("expense amount must be a non-negative number on edit", async () => {
  const res = await authed(a.token).patch(`/api/companies/${a.companyId}/expenses/${a.expenseId}`).send({
    amount: -5,
  });
  assert.equal(res.status, 400);
});

// ---------- Delete: positive controls ----------
// Regression coverage for the expenses.create permission check added to
// DELETE /expenses/:id (it previously had no permission check at all).

test("deleting a pending expense removes it, and a non-pending expense cannot be deleted", async () => {
  const created = await authed(a.token).post(`/api/companies/${a.companyId}/expenses`).send({
    date: "2026-08-04",
    category: "Office Supplies",
    amount: 10,
  });
  assert.equal(created.status, 201);
  const expenseId = created.body.id;

  const deleted = await authed(a.token).delete(`/api/companies/${a.companyId}/expenses/${expenseId}`);
  assert.equal(deleted.status, 204);

  const afterDelete = await authed(a.token).get(`/api/companies/${a.companyId}/expenses/${expenseId}`);
  assert.equal(afterDelete.status, 404);

  // a.expenseId was approved by an earlier test -- deleting it now must be refused.
  const deleteApproved = await authed(a.token).delete(`/api/companies/${a.companyId}/expenses/${a.expenseId}`);
  assert.equal(deleteApproved.status, 409);
});

test("deleting a draft invoice removes it, and a sent invoice cannot be deleted", async () => {
  const created = await authed(a.token).post(`/api/companies/${a.companyId}/invoices`).send({
    customerId: a.customerId,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    lineItems: [{ description: "Delete me", quantity: 1, unitPrice: 1 }],
  });
  assert.equal(created.status, 201);
  const invoiceId = created.body.id;

  const deleted = await authed(a.token).delete(`/api/companies/${a.companyId}/invoices/${invoiceId}`);
  assert.equal(deleted.status, 204);

  const afterDelete = await authed(a.token).get(`/api/companies/${a.companyId}/invoices/${invoiceId}`);
  assert.equal(afterDelete.status, 404);

  const sent = await authed(a.token).post(`/api/companies/${a.companyId}/invoices`).send({
    customerId: a.customerId,
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    status: "sent",
    lineItems: [{ description: "Do not delete me", quantity: 1, unitPrice: 1 }],
  });
  assert.equal(sent.status, 201);

  const deleteSent = await authed(a.token).delete(`/api/companies/${a.companyId}/invoices/${sent.body.id}`);
  assert.equal(deleteSent.status, 409);
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
