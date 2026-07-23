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
 * Covers the admin-driven "register a customer by email, they set their
 * own password later" flow (POST /api/platform/customers): a platform
 * admin registers a brand-new customer + company + pricing tier, Auth0's
 * real Management API calls are mocked (three distinct endpoints: getting
 * a management token, creating the user, and issuing a password-setup
 * ticket) so the test stays offline, and everything on the database side
 * — the created users/company_memberships/company_subscriptions rows —
 * is verified for real against Postgres.
 */

const app = createApp();

let adminToken: string;
let nonAdminToken: string;

before(async () => {
  const adminSub = `auth0|test-admin-${randomUUID()}`;
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO users (email, auth0_sub, status, is_platform_admin)
     VALUES ($1, $2, 'active', true) RETURNING id`,
    [`platform-admin-${Date.now()}@example.com`, adminSub]
  );
  await pool.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, 'Platform Admin')", [
    admin.rows[0].id,
  ]);
  adminToken = signTestAccessToken(adminSub, config.auth0Audience);

  const memberSub = `auth0|test-member-${randomUUID()}`;
  const member = await pool.query<{ id: string }>(
    `INSERT INTO users (email, auth0_sub, status, is_platform_admin)
     VALUES ($1, $2, 'active', false) RETURNING id`,
    [`company-owner-${Date.now()}@example.com`, memberSub]
  );
  await pool.query("INSERT INTO user_profiles (user_id, full_name) VALUES ($1, 'Company Owner')", [
    member.rows[0].id,
  ]);
  nonAdminToken = signTestAccessToken(memberSub, config.auth0Audience);
});

after(async () => {
  await pool.end();
});

function mockAuth0Management(overrides: { createUserStatus?: number; ticketStatus?: number } = {}) {
  const originalFetch = globalThis.fetch;
  const createdEmails: string[] = [];

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);

    if (href.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "fake-management-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (href.endsWith("/api/v2/users")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      createdEmails.push(body.email);
      const status = overrides.createUserStatus ?? 200;
      if (status !== 200) {
        return new Response("error", { status });
      }
      return new Response(JSON.stringify({ user_id: `auth0|created-${randomUUID()}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (href.endsWith("/api/v2/tickets/password-change")) {
      const status = overrides.ticketStatus ?? 200;
      if (status !== 200) {
        return new Response("error", { status });
      }
      return new Response(JSON.stringify({ ticket: "https://example.auth0.com/tickets/fake" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return originalFetch(url as never, init);
  }) as typeof fetch;

  return {
    createdEmails,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("a platform admin can register a new customer by email with a plan tier", async () => {
  const mock = mockAuth0Management();
  const email = `new-customer-${Date.now()}@example.com`;

  try {
    const res = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, companyName: "Brand New Customer Co", plan: "plus" });

    assert.equal(res.status, 201);
    assert.equal(res.body.email, email);
    assert.equal(res.body.plan, "plus");
    assert.equal(res.body.passwordSetupUrl, "https://example.auth0.com/tickets/fake");
    assert.ok(res.body.userId);
    assert.ok(res.body.companyId);
    assert.deepEqual(mock.createdEmails, [email]);

    const userRow = await pool.query("SELECT email, status, password_hash FROM users WHERE id = $1", [
      res.body.userId,
    ]);
    assert.equal(userRow.rows[0].email, email);
    assert.equal(userRow.rows[0].status, "active");
    assert.equal(userRow.rows[0].password_hash, null);

    // company_subscriptions and company_memberships both have row-level
    // security scoped to app.current_company_id -- the plain pool has no
    // tenant context set, so these must run through withTenantContext or
    // RLS silently returns zero rows regardless of whether the insert
    // actually succeeded.
    const subscriptionRow = await withTenantContext(
      { userId: res.body.userId, companyId: res.body.companyId },
      (client) =>
        client.query("SELECT plan, set_by_user_id FROM company_subscriptions WHERE company_id = $1", [
          res.body.companyId,
        ])
    );
    assert.equal(subscriptionRow.rows[0].plan, "plus");

    const membershipRow = await withTenantContext(
      { userId: res.body.userId, companyId: res.body.companyId },
      (client) =>
        client.query("SELECT status FROM company_memberships WHERE company_id = $1 AND user_id = $2", [
          res.body.companyId,
          res.body.userId,
        ])
    );
    assert.equal(membershipRow.rows[0].status, "active");
  } finally {
    mock.restore();
  }
});

test("a non-admin cannot register a customer", async () => {
  const mock = mockAuth0Management();
  try {
    const res = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${nonAdminToken}`)
      .send({ email: `blocked-${Date.now()}@example.com`, companyName: "Should Not Exist", plan: "easystart" });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "Access denied." });
    assert.deepEqual(mock.createdEmails, []); // Auth0 was never even called
  } finally {
    mock.restore();
  }
});

test("registering a customer with an invalid plan is rejected before calling Auth0 at all", async () => {
  const mock = mockAuth0Management();
  try {
    const res = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: `bad-plan-${Date.now()}@example.com`, companyName: "Co", plan: "enterprise-deluxe" });
    assert.equal(res.status, 400);
    assert.deepEqual(mock.createdEmails, []);
  } finally {
    mock.restore();
  }
});

test("registering a duplicate email is rejected", async () => {
  const mock = mockAuth0Management();
  const email = `dup-${Date.now()}@example.com`;
  try {
    const first = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, companyName: "First Co", plan: "easystart" });
    assert.equal(first.status, 201);

    const second = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, companyName: "Second Co", plan: "advanced" });
    assert.equal(second.status, 409);
    assert.deepEqual(mock.createdEmails, [email]); // Auth0 was only called once, for the first attempt
  } finally {
    mock.restore();
  }
});

test("if the password-setup ticket call fails, the customer is still fully created", async () => {
  const mock = mockAuth0Management({ ticketStatus: 500 });
  const email = `ticket-fails-${Date.now()}@example.com`;
  try {
    const res = await request(app)
      .post("/api/platform/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, companyName: "Ticket Fails Co", plan: "easystart" });

    assert.equal(res.status, 201);
    assert.equal(res.body.passwordSetupUrl, null);

    const userRow = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    assert.equal(userRow.rows.length, 1);
  } finally {
    mock.restore();
  }
});
