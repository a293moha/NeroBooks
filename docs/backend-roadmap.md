# NeroBooks — Backend Roadmap

This proposes an architecture and phased plan to turn NeroBooks from a
localStorage-only demo into a real multi-user product. It assumes nothing
about timeline or budget beyond "do this in a sane order" — adjust freely.

## Recommended backend architecture

**Style:** a single REST (or GraphQL, either is fine here — REST recommended
for speed of delivery given the frontend already models each entity 1:1 with a
CRUD resource) API service, backed by a relational database. This is a
standard small-business SaaS shape — nothing about NeroBooks' domain needs
microservices, event sourcing, or anything exotic at this scale.

```text
┌─────────────────┐        HTTPS/JSON         ┌──────────────────────┐
│  React SPA       │ ───────────────────────▶ │   API server          │
│  (this repo,      │ ◀─────────────────────── │  (Node/Express,       │
│   unchanged        │    session/JWT auth      │   Fastify, or         │
│   routing/UI)      │                          │   NestJS)             │
└─────────────────┘                            └───────────┬──────────┘
                                                             │
                                    ┌────────────────────────┼─────────────────────┐
                                    ▼                        ▼                     ▼
                          ┌──────────────────┐    ┌────────────────────┐  ┌─────────────────┐
                          │ PostgreSQL         │    │ Payments provider   │  │ Currency-rate API │
                          │ (all entities,     │    │ (Stripe Billing —    │  │ (e.g. exchangerate │
                          │  §database-        │    │  replaces self-      │  │  -api.com, open    │
                          │  requirements.md)   │    │  serve plan switch)  │  │  exchangerates.io) │
                          └──────────────────┘    └────────────────────┘  └─────────────────┘
```

**Why this shape:**

- The frontend is already fully decomposed by entity (Customer, Vendor,
  Invoice, Expense, Account, Transaction, TeamMember, plus Auth/Billing) — a
  straightforward REST resource per entity maps directly onto the existing
  `DataContext`/`AuthContext`/`TeamContext` calls, minimizing frontend rewrite.
- A relational database is the right fit because the domain is inherently
  relational (invoices reference customers, transactions reference accounts,
  team members belong to one company) and needs transactional integrity
  (double-entry bookkeeping, invoice totals, account balances must never
  drift out of sync).
- **Multi-tenancy is required from day one** — right now every browser's
  localStorage is its own silo; a real backend needs a `company`/`organization`
  concept so Team members actually share the same books, which is the entire
  point of the Team feature existing.

**Suggested stack** (opinionated, swap for team preference):

- **API:** Node.js + TypeScript (reuses types from `src/types.ts` almost
  directly) — Fastify or NestJS. Keeping it TypeScript lets you share
  validation schemas (Zod) between frontend and backend.
- **Database:** PostgreSQL. Use an ORM with real migrations (Prisma or
  Drizzle) — do not hand-write SQL migrations for this size of schema.
- **Auth:** Don't hand-roll it. Use a managed auth provider (Clerk, Auth0,
  Supabase Auth) or a well-vetted library (Lucia, `better-auth`) rather than
  writing password hashing/session/reset-token flows from scratch — this is
  the single highest-risk area to get wrong (see `security-risks.md`).
- **Billing:** Stripe Billing (Checkout + Customer Portal + webhooks). Do not
  build a custom subscription/invoicing system for your own SaaS billing —
  use the thing built for exactly this.
- **Currency rates:** Any exchange-rate API with a free tier
  (exchangerate-api.com, open.er-api.com) polled on a daily cron, cached in
  the database. Do not call a live rate API on every page load.
- **Hosting for the API:** Any Node-friendly platform (Render, Fly.io,
  Railway) or containerized on the same cloud as the database. GitHub Pages
  (current frontend host) **cannot run this** — it only serves static files —
  so the frontend stays on Pages and the API is a separate deployment the
  frontend calls over HTTPS.

## What's real vs. display-only today (recap, drives priority below)

Real, wired-to-localStorage-only (needs a real backend to become multi-user):
customers, vendors, invoices, expenses, accounts, transactions, team invites,
plan/billing state, selected currency.

Display-only in the current build, would need entirely new subsystems, not
just "add a backend" for the existing UI: inventory tracking, time tracking,
project management, e-signatures/contracts, lead/reputation management,
custom report builder, workflow automation, mobile app, third-party
integrations, custom roles/permissions, backup/restore, live currency
forecasting. These are accurately represented in the Billing page's feature
matrix as "included in plan X" but nothing behind them exists to connect a
backend to yet — building the backend for these means building the feature
first.

## Proposed implementation order

### Phase 0 — Foundations (do first, blocks everything else)

1. Stand up the API skeleton + Postgres + migrations for the core schema
   (`database-requirements.md`).
2. Real auth: signup/login/logout, password hashing, session or JWT issuance,
   **email verification**, **password reset** (currently doesn't exist at
   all). Wire `AuthContext.signIn/signOut` to call the real API instead of
   writing straight to localStorage.
3. Introduce the `Organization`/`Company` concept and require every other
   table to be scoped to one — this is what makes "Team" mean something.
4. Environment-variable setup for the frontend (`VITE_API_BASE_URL`) and
   backend (DB connection string, JWT secret, etc.) — currently zero env vars
   exist anywhere.

### Phase 1 — Core accounting data (highest user-visible value)

1. CRUD API + DB tables for Customers, Vendors, Expenses, Invoices (with line
   items) — replace `DataContext`'s localStorage read/write with `fetch` calls.
   Add the edit/delete operations that don't currently exist in the UI at all
   for these entities.
2. Chart of Accounts and Transactions: move from read-only seed data to real
   CRUD, and — critically — compute account balances from the transaction
   ledger server-side rather than storing a denormalized `balance` field that
   can drift (current mock data stores `balance` directly on `Account`, which
   is a shortcut that doesn't hold up once transactions can be added freely).
3. Reports (P&L, Balance Sheet, Cash Flow) computed server-side from real
   ledger data instead of the current mix of seeded account balances.

### Phase 2 — Team and billing (makes the plan-gating meaningful)

1. Real team invitations: send an actual invite email, require the invitee to
   accept, store membership + role server-side. Enforce the seat cap
   (1/5/25 per plan) in the API, not just in the frontend — right now the cap
   is purely a client-side check in `Team.tsx`, easily bypassed by calling
   `TeamContext.addInvitee` directly from devtools.
2. Stripe Billing integration: real checkout for EasyStart/Plus/Advanced,
   webhook-driven plan updates (never trust the client to say what plan it's
   on), Customer Portal for self-serve plan changes/cancellation.

### Phase 3 — Supporting features

1. Live currency exchange rates (replace the static table in
   `exchangeRates.ts`), refreshed on a schedule.
2. CSV export moved server-side if/when export volume or data size makes a
   client-side `Blob` impractical (not urgent — current implementation is
   fine at demo scale).
3. Forecast/Budgeting: decide whether to keep the current naive linear
   projection (fine for a demo, should be clearly labeled as such
   permanently) or invest in a real forecasting model — this is a product
   decision, not a backend requirement.

### Phase 4 — New subsystems (only if/when prioritized)

1. Any of: inventory tracking, time tracking, project management,
   e-signature/contracts, custom report builder, workflow automation,
   integrations marketplace, custom roles & permissions, backup/restore.
   Each of these is a standalone feature project (new tables, new UI, often a
   third-party integration) — sequence them by business priority, not
   engineering convenience, and do not treat "connect a backend" as the
   remaining work for any of them, since none has a frontend built yet
   either.

## Risks that could affect production deployment

- **Static frontend host + dynamic backend = CORS and mixed-origin config.**
  The frontend on GitHub Pages will call an API on a different domain — CORS
  must be configured correctly on the API, and the frontend's `base:
  '/NeroBooks/'` Vite config plus `HashRouter` routing both need re-validation
  once real navigation/redirects (e.g. post-payment redirect from Stripe) are
  introduced.
- **GitHub Pages has no secret storage.** Any API keys, client secrets, or
  Stripe publishable-vs-secret key confusion must be handled carefully — only
  truly public keys (Stripe publishable key) can ever ship in the frontend
  bundle; everything else lives only on the API server.
- **No repo rename safety net.** `vite.config.ts`'s hardcoded `base:
  '/NeroBooks/'` broke the deployed site once already during a repo rename in
  this project's history — document this dependency clearly so it isn't
  repeated when the app moves to a real domain (at which point `base` should
  become `/`).
- **Migrating existing "data."** There is no real user data to migrate (it's
  all per-browser localStorage), but there *is* a UX question: when a user who
  has been using the demo signs up for a real account, should their local
  data import into the new backend, or do they start fresh? Decide before
  launch — don't let this be an afterthought that surprises early users.
- **Plan/seat enforcement must move server-side before this handles real
  money.** Right now anyone can set `localStorage["nerobooks-auth"]` to claim
  any plan. This is fine for a demo; it is not fine the moment Stripe is
  wired up and plan = billing tier.
- **No monitoring/alerting/logging exists anywhere.** Before real users touch
  this, add at minimum error tracking (Sentry or similar) on both frontend and
  backend, and basic uptime monitoring on the API.
