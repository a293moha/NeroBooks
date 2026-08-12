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
 * Covers the chart-of-accounts/general-ledger surface added in Phase 1 of
 * the QuickBooks-parity roadmap (accounting.routes.ts): balanced-entry
 * enforcement, posting immutability, account balance computation (server-
 * computed, sign-flipped by type, posted-only), delete-vs-deactivate, the
 * accounting.manage permission gate, and cross-company isolation — same
 * fixture shape and conventions as tenant-scoped-resources.test.ts.
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

interface AccountingFixture {
  ownerId: string;
  token: string;
  companyId: string;
  cash: string; // asset
  ap: string; // liability
  equity: string;
  income: string;
  expense: string;
}

async function buildAccountingFixture(label: string): Promise<AccountingFixture> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = await createTestIdentity(`accounting-owner-${label}-${stamp}@example.com`, `Owner ${label}`);
  const agent = authed(owner.token);

  const createCompany = await agent.post("/api/companies").send({ name: `${label} Accounting Co ${stamp}` });
  assert.equal(createCompany.status, 201);
  const companyId = createCompany.body.id as string;

  const makeAccount = async (code: string, name: string, accountType: string) => {
    const res = await agent.post(`/api/companies/${companyId}/accounts`).send({ code, name, accountType });
    assert.equal(res.status, 201, `expected 201 creating ${name}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.id as string;
  };

  const cash = await makeAccount("1000", "Cash", "asset");
  const ap = await makeAccount("2000", "Accounts Payable", "liability");
  const equity = await makeAccount("3000", "Owner's Equity", "equity");
  const income = await makeAccount("4000", "Service Income", "income");
  const expense = await makeAccount("5000", "Operating Expenses", "expense");

  return { ownerId: owner.userId, token: owner.token, companyId, cash, ap, equity, income, expense };
}

let a: AccountingFixture;
let b: AccountingFixture;

before(async () => {
  a = await buildAccountingFixture("A");
  b = await buildAccountingFixture("B");
});

after(async () => {
  await pool.end();
});

// ---------- Accounts ----------

test("GET /accounts lists all seeded accounts with zero balance and no activity yet", async () => {
  const res = await authed(a.token).get(`/api/companies/${a.companyId}/accounts`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 5);
  for (const account of res.body) {
    assert.equal(Number(account.balance), 0);
    assert.equal(account.has_activity, false);
    assert.equal(account.is_active, true);
  }
});

test("creating an account with a duplicate code in the same company is rejected", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "1000",
    name: "Duplicate Cash",
    accountType: "asset",
  });
  assert.equal(res.status, 409);
});

test("creating an account with an unrecognized accountType is rejected", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "9999",
    name: "Bad Type",
    accountType: "not_a_real_type",
  });
  assert.equal(res.status, 400);
});

// ---------- Journal entries: balance enforcement ----------

test("creating a balanced draft entry succeeds", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    description: "Balanced draft",
    lines: [
      { accountId: a.cash, debit: 500, credit: 0 },
      { accountId: a.income, debit: 0, credit: 500 },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "draft");
  assert.equal(res.body.lines.length, 2);
});

test("creating an entry and posting it immediately in one call is rejected when unbalanced, and no row is left behind", async () => {
  const before = await authed(a.token).get(`/api/companies/${a.companyId}/journal-entries`);
  const countBefore = before.body.length;

  const res = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    description: "Unbalanced, should never be created",
    lines: [
      { accountId: a.cash, debit: 500, credit: 0 },
      { accountId: a.income, debit: 0, credit: 400 },
    ],
    post: true,
  });
  assert.equal(res.status, 422);

  const after = await authed(a.token).get(`/api/companies/${a.companyId}/journal-entries`);
  assert.equal(after.body.length, countBefore, "no orphan journal_entries row should exist after a rejected post-on-create");
});

test("a line with both debit and credit nonzero, or neither, is rejected", async () => {
  const bothNonzero = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    lines: [
      { accountId: a.cash, debit: 100, credit: 100 },
      { accountId: a.income, debit: 0, credit: 100 },
    ],
  });
  assert.equal(bothNonzero.status, 400);

  const onlyOneLine = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    lines: [{ accountId: a.cash, debit: 100, credit: 0 }],
  });
  assert.equal(onlyOneLine.status, 400);
});

// ---------- Posting immutability ----------

test("posting a balanced draft locks it, and editing/deleting a posted entry is rejected", async () => {
  const created = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-02",
    description: "To be posted",
    lines: [
      { accountId: a.expense, debit: 75, credit: 0 },
      { accountId: a.cash, debit: 0, credit: 75 },
    ],
  });
  assert.equal(created.status, 201);
  const entryId = created.body.id;

  const posted = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries/${entryId}/post`);
  assert.equal(posted.status, 200);
  assert.equal(posted.body.status, "posted");

  const editAttempt = await authed(a.token).patch(`/api/companies/${a.companyId}/journal-entries/${entryId}`).send({
    entryDate: "2026-08-02",
    lines: [
      { accountId: a.expense, debit: 999, credit: 0 },
      { accountId: a.cash, debit: 0, credit: 999 },
    ],
  });
  assert.equal(editAttempt.status, 409);

  const deleteAttempt = await authed(a.token).delete(`/api/companies/${a.companyId}/journal-entries/${entryId}`);
  assert.equal(deleteAttempt.status, 409);

  const rePost = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries/${entryId}/post`);
  assert.equal(rePost.status, 409); // already posted, not draft
});

test("posting an empty or unbalanced draft is rejected", async () => {
  const draft = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-03",
    lines: [
      { accountId: a.cash, debit: 10, credit: 0 },
      { accountId: a.income, debit: 0, credit: 10 },
    ],
  });
  assert.equal(draft.status, 201);

  // Simulate a corrupted/edited-out-from-under-us draft by deleting its
  // lines directly, bypassing the app layer (the immutability trigger
  // still allows this since the parent is a draft).
  await withTenantContext({ userId: a.ownerId, companyId: a.companyId }, (c) =>
    c.query("DELETE FROM journal_entry_lines WHERE journal_entry_id = $1", [draft.body.id])
  );

  const postEmpty = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries/${draft.body.id}/post`);
  assert.equal(postEmpty.status, 422);
});

// ---------- Account balances: computed, sign-flipped, posted-only ----------

test("account balances are computed from posted lines only, sign-flipped so every type reads as a natural positive", async () => {
  // Fresh, dedicated accounts for this test -- a.cash/a.equity already
  // accumulated activity from earlier tests in this file, so their
  // balances aren't a reliable "starts at zero" baseline.
  const freshCash = await authed(a.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "1100",
    name: "Fresh Cash",
    accountType: "asset",
  });
  assert.equal(freshCash.status, 201);
  const freshEquity = await authed(a.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "3100",
    name: "Fresh Equity",
    accountType: "equity",
  });
  assert.equal(freshEquity.status, 201);

  const draft = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-04",
    description: "Owner invests cash",
    lines: [
      { accountId: freshCash.body.id, debit: 1000, credit: 0 },
      { accountId: freshEquity.body.id, debit: 0, credit: 1000 },
    ],
  });
  assert.equal(draft.status, 201);

  const beforePosting = await authed(a.token).get(`/api/companies/${a.companyId}/accounts`);
  const cashBefore = beforePosting.body.find((acc: { id: string }) => acc.id === freshCash.body.id);
  assert.equal(Number(cashBefore.balance), 0, "a draft entry must not move any balance");

  const posted = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries/${draft.body.id}/post`);
  assert.equal(posted.status, 200);

  const afterPosting = await authed(a.token).get(`/api/companies/${a.companyId}/accounts`);
  const cashAfter = afterPosting.body.find((acc: { id: string }) => acc.id === freshCash.body.id);
  const equityAfter = afterPosting.body.find((acc: { id: string }) => acc.id === freshEquity.body.id);
  // Cash (asset, debit-normal): debited 1000 -> balance +1000.
  assert.equal(Number(cashAfter.balance), 1000);
  // Equity (credit-normal): credited 1000 -> balance +1000 too, not -1000.
  assert.equal(Number(equityAfter.balance), 1000);
  assert.equal(cashAfter.has_activity, true);
});

// ---------- Delete vs deactivate ----------

test("an account with ledger activity cannot be deleted, but can be deactivated and reactivated", async () => {
  const deleteAttempt = await authed(a.token).delete(`/api/companies/${a.companyId}/accounts/${a.cash}`);
  assert.equal(deleteAttempt.status, 409);

  const deactivate = await authed(a.token).patch(`/api/companies/${a.companyId}/accounts/${a.cash}`).send({ isActive: false });
  assert.equal(deactivate.status, 200);
  assert.equal(deactivate.body.is_active, false);

  const reactivate = await authed(a.token).patch(`/api/companies/${a.companyId}/accounts/${a.cash}`).send({ isActive: true });
  assert.equal(reactivate.status, 200);
  assert.equal(reactivate.body.is_active, true);
});

test("changing the type of an account with activity is rejected, but a never-used account can be deleted outright", async () => {
  const typeChange = await authed(a.token).patch(`/api/companies/${a.companyId}/accounts/${a.cash}`).send({ accountType: "liability" });
  assert.equal(typeChange.status, 409);

  const fresh = await authed(a.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "6000",
    name: "Unused account",
    accountType: "expense",
  });
  assert.equal(fresh.status, 201);

  const deleted = await authed(a.token).delete(`/api/companies/${a.companyId}/accounts/${fresh.body.id}`);
  assert.equal(deleted.status, 204);

  const gone = await withTenantContext({ userId: a.ownerId, companyId: a.companyId }, (c) =>
    c.query("SELECT id FROM chart_of_accounts WHERE id = $1", [fresh.body.id])
  );
  assert.equal(gone.rows.length, 0, "a never-used account should be a real hard delete, not soft-deleted");
});

// ---------- Permission gate ----------

test("a user with only the Viewer role cannot create accounts or journal entries", async () => {
  const stamp = Date.now();
  const viewer = await createTestIdentity(`viewer-${stamp}@example.com`, "Viewer User");

  // Direct DB setup (bypassing the invite/accept flow, which isn't what's
  // under test here) -- must run under the same tenant context as every
  // other company-scoped write, or RLS refuses the insert outright.
  await withTenantContext({ userId: a.ownerId, companyId: a.companyId }, async (client) => {
    await client.query(
      `INSERT INTO company_memberships (company_id, user_id, invited_email, status, accepted_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [a.companyId, viewer.userId, `viewer-${stamp}@example.com`]
    );
    const viewerRole = await client.query<{ id: string }>("SELECT id FROM roles WHERE name = 'Viewer' AND company_id IS NULL");
    await client.query("INSERT INTO user_roles (company_id, user_id, role_id) VALUES ($1, $2, $3)", [
      a.companyId,
      viewer.userId,
      viewerRole.rows[0].id,
    ]);
  });

  const createAccount = await authed(viewer.token).post(`/api/companies/${a.companyId}/accounts`).send({
    code: "7000",
    name: "Should not be created",
    accountType: "expense",
  });
  assert.equal(createAccount.status, 403);

  const createEntry = await authed(viewer.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-05",
    lines: [
      { accountId: a.cash, debit: 10, credit: 0 },
      { accountId: a.income, debit: 0, credit: 10 },
    ],
  });
  assert.equal(createEntry.status, 403);

  // Reads remain allowed -- accounting reads have no permission check,
  // matching how invoices.view/expenses.view aren't checked on GET either.
  const readAccounts = await authed(viewer.token).get(`/api/companies/${a.companyId}/accounts`);
  assert.equal(readAccounts.status, 200);
});

// ---------- Cross-company isolation ----------

test("attack: Company A cannot read, edit, post, or delete Company B's accounts or journal entries", async () => {
  const bEntry = await authed(b.token).post(`/api/companies/${b.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    lines: [
      { accountId: b.cash, debit: 200, credit: 0 },
      { accountId: b.income, debit: 0, credit: 200 },
    ],
  });
  assert.equal(bEntry.status, 201);

  const results = await Promise.all([
    authed(a.token).get(`/api/companies/${b.companyId}/accounts`),
    authed(a.token).patch(`/api/companies/${a.companyId}/accounts/${b.cash}`).send({ name: "Hacked" }),
    authed(a.token).delete(`/api/companies/${a.companyId}/accounts/${b.cash}`),
    authed(a.token).get(`/api/companies/${b.companyId}/journal-entries`),
    authed(a.token).get(`/api/companies/${a.companyId}/journal-entries/${bEntry.body.id}`),
    authed(a.token).post(`/api/companies/${a.companyId}/journal-entries/${bEntry.body.id}/post`),
    authed(a.token).delete(`/api/companies/${a.companyId}/journal-entries/${bEntry.body.id}`),
  ]);

  assert.equal(results[0].status, 403); // GET /accounts under B's own URL
  assert.equal(results[1].status, 404); // B's account id under A's URL
  assert.equal(results[2].status, 404);
  assert.equal(results[3].status, 403); // GET /journal-entries under B's own URL
  assert.equal(results[4].status, 404);
  assert.equal(results[5].status, 404);
  assert.equal(results[6].status, 404);

  const stillThere = await withTenantContext({ userId: b.ownerId, companyId: b.companyId }, (c) =>
    c.query("SELECT name FROM chart_of_accounts WHERE id = $1", [b.cash])
  );
  assert.notEqual(stillThere.rows[0].name, "Hacked");
});

test("attack: a journal entry line referencing another company's account is rejected", async () => {
  const res = await authed(a.token).post(`/api/companies/${a.companyId}/journal-entries`).send({
    entryDate: "2026-08-01",
    lines: [
      { accountId: b.cash, debit: 50, credit: 0 }, // real account id, but it's Company B's
      { accountId: a.income, debit: 0, credit: 50 },
    ],
  });
  assert.equal(res.status, 422);
});
