# NeroBooks — Database Requirements

This derives a relational schema from what `src/types.ts` and the `context/`
providers already model, plus the tables that don't exist in the frontend at
all today but are required the moment there's more than one browser sharing
data (auth, organizations, billing).

Target: PostgreSQL. Types below are Postgres-flavored; adjust for your ORM
(Prisma/Drizzle) syntax as needed.

## New concepts not in the current frontend

The current app has **no concept of an organization** — every entity is
implicitly "whatever's in this browser's localStorage." A real backend must
introduce one, and scope every other table to it:

- **`organizations`** — one row per company using NeroBooks.
- **`users`** — real accounts with real credentials (today: `AuthContext`
  fakes this with an unverified `{name, email, plan}` object).
- **`memberships`** — replaces `TeamContext`'s flat `invitees[]` array; links
  users to an organization with a role, and models the pending-invite state
  that today doesn't really exist (`Team.tsx` invites are accepted instantly,
  with no invitee-side confirmation step).
- **`subscriptions`** — replaces the self-reported `AuthUser.plan` field with
  something a payment webhook controls, not the client.

## Core tables

### `organizations`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, not null | |
| default_currency | text(3), not null, default `'USD'` | replaces `CurrencyContext`'s per-browser localStorage value |
| created_at | timestamptz, not null, default now() | |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| email | text, unique, not null | |
| password_hash | text, not null | **never store the plaintext password** — see `security-risks.md`; today's app doesn't store it at all, hashed or otherwise |
| name | text, not null | |
| email_verified_at | timestamptz, null | no verification exists today |
| created_at | timestamptz, not null, default now() | |

### `password_reset_tokens`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK → users.id | |
| token_hash | text, not null | store the hash, not the raw token |
| expires_at | timestamptz, not null | short-lived, e.g. 1 hour |
| used_at | timestamptz, null | |

Entirely new — no password-reset flow exists in the current app at all.

### `memberships`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK → organizations.id | |
| user_id | uuid, FK → users.id, null | null until an invited user accepts |
| invited_email | text, not null | |
| role | text, not null, check in `('owner','member')` | current UI only distinguishes "Owner" (the signed-in user) vs "Member" (`Team.tsx`) |
| status | text, not null, check in `('pending','accepted','removed')` | current app has no pending state — `addInvitee` is instant |
| invited_at | timestamptz, not null, default now() | |
| accepted_at | timestamptz, null | |

**Seat-limit enforcement belongs here**: `count(*) where organization_id = ?
and status != 'removed'` compared against the plan's `maxTeamMembers`
(1/5/25 — see `src/lib/featureMatrix.ts`), checked server-side on invite,
not just in the `Team.tsx` UI as today.

### `subscriptions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK → organizations.id, unique | one active plan per org |
| plan | text, not null, check in `('easystart','plus','advanced')` | matches `PlanId` in `src/lib/featureMatrix.ts` exactly |
| stripe_customer_id | text, null | |
| stripe_subscription_id | text, null | |
| status | text, not null | e.g. `active`, `past_due`, `canceled` — mirror Stripe's status enum |
| current_period_end | timestamptz, null | |
| updated_at | timestamptz, not null, default now() | **only updated by the Stripe webhook handler**, never by a client request — this is the single most important rule carried over from `backend-roadmap.md` |

## Accounting entities (map ~1:1 to `src/types.ts`)

### `customers`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| name | text, not null | |
| email | text, not null | today: no format validation anywhere — add a check constraint or validate at the API layer |
| phone | text, null | |
| company | text, null | |
| created_at / updated_at | timestamptz | current UI has no edit capability — add it once this exists |

`balance` is **intentionally not a column** — see "Derived vs. stored data"
below.

### `vendors`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| name | text, not null | |
| email | text, not null | |
| category | text, not null | free text today (`src/pages/Vendors.tsx`); consider an enum or lookup table if the category list should be constrained |
| created_at / updated_at | timestamptz | |

### `invoices`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| customer_id | uuid, FK → customers.id | |
| number | text, not null | unique per organization — today's `INV-${1000+n}` scheme (`Invoices.tsx`) will collide across concurrent users; use a per-org sequence |
| issue_date | date, not null | |
| due_date | date, not null | |
| status | text, not null, check in `('draft','sent','paid','overdue')` | matches `InvoiceStatus` |
| currency | text(3), null | null = use `organizations.default_currency`; matches the optional `currency?` override already in `types.ts`, gated to Plus/Advanced plans |
| recurring | boolean, not null, default false | today this is **display-only** (`types.ts` comment: "No auto-rebilling engine — display only") — if kept, this table alone isn't enough; a recurrence needs a schedule and a job that actually creates the next invoice |
| notes | text, null | |
| created_at / updated_at | timestamptz | |

### `invoice_line_items`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| invoice_id | uuid, FK → invoices.id, on delete cascade | |
| description | text, not null | |
| qty | numeric, not null, check (qty >= 0) | |
| rate | numeric, not null, check (rate >= 0) | today's `min={0}` is HTML-only and not enforced server-side |

Invoice total is **computed** (`sum(qty * rate)`), matching
`invoiceTotal()` in `src/lib/format.ts` — do not also store a denormalized
total that can drift from the line items.

### `expenses`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| vendor_id | uuid, FK → vendors.id | |
| date | date, not null | |
| category | text, not null | matches the fixed `ExpenseCategory` union in `types.ts` (Advertising, Office Supplies, Travel, Utilities, Rent, Software, Payroll, Insurance, Other) — enforce via check constraint or lookup table |
| amount | numeric, not null, check (amount >= 0) | |
| memo | text, null | |
| payment_method | text, not null | free text today |
| created_at | timestamptz | |

### `accounts` (Chart of Accounts)
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| code | text, not null | e.g. `1000`, `2000` |
| name | text, not null | |
| type | text, not null, check in `('Asset','Liability','Equity','Income','Expense')` | matches `AccountType` |
| created_at | timestamptz | |

`balance` is **not a column** — see below.

### `ledger_transactions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| organization_id | uuid, FK | |
| account_id | uuid, FK → accounts.id | |
| date | date, not null | |
| description | text, not null | |
| debit | numeric, not null, default 0, check (debit >= 0) | |
| credit | numeric, not null, default 0, check (credit >= 0) | |
| created_at | timestamptz | |

(Renamed from the frontend's `Transaction` to `ledger_transactions` to avoid
colliding with SQL's own "transaction" terminology — purely a naming choice.)

## Derived vs. stored data — the most important schema decision here

**Today's mock data stores `balance` directly on `Account` and `Customer`/
`Vendor`** (`src/lib/seed.ts`) as a flat number that the UI just displays. This
is fine for a hard-coded demo where nothing ever recalculates it, but it is
the wrong model for a real ledger: once transactions can be added freely,
a stored balance *will* drift from reality unless every single write path
remembers to update it too.

**Recommendation:** don't store `balance` at all. Compute it on read:

```sql
-- Account balance
select coalesce(sum(debit) - sum(credit), 0)
from ledger_transactions
where account_id = $1;

-- Customer balance (sum of unpaid invoice totals)
select coalesce(sum(li.qty * li.rate), 0)
from invoices i
join invoice_line_items li on li.invoice_id = i.id
where i.customer_id = $1 and i.status in ('sent', 'overdue');
```

If read performance becomes a real problem at scale, add a materialized
view or a cached/denormalized column updated via a database trigger — but
start correct, then optimize, rather than starting with a field that can lie.

## Reference data (static — does not need to be user-editable tables yet)

These currently live as hand-written TypeScript constants and can stay that
way on the backend too, **unless** you want non-developers to edit them
without a deploy:

- `src/lib/currencies.ts` — ~170 ISO 4217 currencies. Keep as static
  reference data; there is no need for a `currencies` table unless you want
  to support currencies dynamically.
- `src/lib/countries.ts` — ~195 countries → default currency. Same.
- `src/lib/plans.ts` / `featureMatrix.ts` — the 3-tier plan/feature matrix.
  Keep in code (or a config file loaded by the API) rather than a database
  table, *unless* there's a product requirement for admins to change pricing
  or feature flags without shipping a deploy — that's the only reason to move
  this into the database.

One exception that **should** become a real table with live data:

### `exchange_rates`
| Column | Type | Notes |
|---|---|---|
| currency_code | text(3), PK | |
| rate_per_usd | numeric, not null | |
| as_of | date, not null | |

Replaces the static, never-updating table in `src/lib/exchangeRates.ts`
(whose own comment admits: "Approximate exchange rates... For demo/display
purposes only — not wired to a live rates feed"). Refresh on a daily cron from
a real rates API (see `backend-roadmap.md`).

## Indexes (minimum viable set)

- Every `organization_id` foreign key column — nearly every query in the app
  filters by organization; this is the single most important index category.
- `users.email` — unique index (used for login lookup).
- `invoices.(organization_id, number)` — unique index (per-org invoice
  numbering).
- `memberships.(organization_id, invited_email)` — unique index, prevents
  duplicate invites.
- `ledger_transactions.(account_id, date)` — supports balance and register
  queries efficiently.

## Multi-tenancy enforcement

Every table above except `organizations` itself must be scoped by
`organization_id`, and **every single query the API makes must filter by
it** — there is currently no tenant isolation of any kind (the entire concept
of "which org's data is this" doesn't exist yet, because there's only ever
one implicit tenant: whichever browser is looking at its own localStorage).
If using Postgres, consider row-level security (RLS) policies keyed on
`organization_id` as a defense-in-depth backstop against an API bug leaking
one organization's data to another.
