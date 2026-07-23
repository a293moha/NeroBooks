# NeroBooks — Production Database Schema

This documents the PostgreSQL schema implemented in `db/migrations/`: 39
tables, multi-tenant from the ground up, supporting the accounting and
payroll domain described in `backend-roadmap.md` and
`database-requirements.md`. Every migration in this document has been
applied to and rolled back against a real local PostgreSQL 16 instance as
part of building it — this is not an unverified design on paper.

If you haven't read them yet, `current-architecture.md`,
`backend-roadmap.md`, and `database-requirements.md` (also in this folder)
cover the frontend this backend eventually serves and the reasoning that
led here. This document stands on its own for the schema itself.

## Design principles (apply to every table unless a table's section says otherwise)

- **UUID primary keys**, generated with `gen_random_uuid()` (via the
  `pgcrypto` extension, enabled in migration `0001`).
- **`company_id` on every company-owned record** — including line-item and
  detail tables one join away from their company (e.g.
  `employee_bank_accounts`, `invoice_items`, `journal_entry_lines`), not
  just the top-level parent. This is deliberately denormalized: every table
  can be filtered, indexed, and — if you add it later — row-level-secured
  on one column, with no join required. The four exceptions are documented
  in "Deliberate exceptions to company_id" below.
- **Foreign keys everywhere a relationship exists**, with an explicit
  `ON DELETE` behavior chosen per relationship (`CASCADE`,
  `SET NULL`, or implicitly `RESTRICT` — Postgres's default — where a
  parent must never disappear out from under a child; see each table's
  section).
- **`created_at timestamptz` and `updated_at timestamptz` on every table**,
  one deliberate exception (`audit_logs`, see its section). All timestamps
  in this schema are `timestamptz`, not bare `timestamp` — Postgres stores
  these normalized to UTC internally and converts on display, so there is
  never ambiguity about which timezone a stored instant means. Calendar
  dates that don't carry a time-of-day meaning (`hire_date`, `issue_date`,
  `period_start`, ...) use `date`, not `timestamptz` — mixing the two up is
  a common source of off-by-one-day bugs across timezones, so this schema
  is consistent: a **date** column never has time zone baggage, a
  **timestamptz** column is always a precise instant.
- **Money is always `numeric(19,4)`**, never `real`/`double
  precision`/floating point, anywhere in this schema (verified — see
  "Verification" below). 4 decimal places gives headroom beyond 2-decimal
  display currencies without any rounding error accumulating across
  calculations; the application layer formats for display.
- **Soft deletion (`deleted_at timestamptz`) only where a row can
  legitimately stop being "current" while still needing to exist for
  historical/referential reasons** — a customer, an employee, a chart-of-
  accounts entry. Pure append-only history (`employee_tax_profiles`,
  `employment_records`) and pure junction tables (`role_permissions`,
  `user_roles`) don't get `deleted_at`; see each table's section for why.
- **Immutability enforced by triggers, not just application discipline.**
  Anywhere this document says a record "must be immutable after approval,"
  there is a `BEFORE UPDATE OR DELETE` trigger in the migrations that
  actually raises an exception if violated — tested with real INSERT/
  UPDATE/DELETE statements in `db/tests/verify_immutability.sql`, not just
  reviewed by eye.

## How to read this document

Tables are grouped the same way the migrations are (`0002` through `0015`).
For each table: **purpose**, **relationships**, and anything notable about
retention/immutability. Indexing strategy and the full immutability list are
each pulled into their own section afterward rather than repeated per table.

---

## Companies (`0002`)

### `companies`
The tenant root. Every other company-owned table's `company_id` ultimately
points here. Soft-deleted only — a closed/offboarded company's historical
financial and payroll records must remain queryable for legal/tax retention
long after the relationship ends; nothing about this schema ever hard-deletes
a company.

### `company_settings`
1:1 with `companies` (`company_id UNIQUE`). Split out so that frequently
changing operational preferences (invoice numbering, default pay frequency)
don't churn the tenant root row. Includes an `extra jsonb` escape hatch for
settings that don't yet warrant their own column — use sparingly; promote a
JSONB key to a real column once it needs to be indexed, validated, or
queried across companies.

---

## Identity (`0003`)

### `users`
Platform-wide login identity — **not** company-scoped directly. One person
(a bookkeeper working across several client companies, for instance) can
belong to many companies; see `company_memberships`. Soft-deleted only:
many other tables reference a user via `created_by`/`approved_by`/
`uploaded_by` for audit purposes, and those references must stay valid
after someone leaves. `email` is `citext` (case-insensitive) with a unique
index scoped to non-deleted rows, so a deactivated account's email can be
reused by a new signup.

### `user_profiles`
1:1 display data (name, avatar, locale) split from the auth-critical `users`
row, so a profile edit never touches the security-sensitive table.

---

## Access control (`0004`)

### `company_memberships`
Links a user to a company. Can exist **before** the invited person has a
`users` row at all: `status = 'pending'`, `user_id NULL`, `invited_email`
set — filled in with `user_id` once they accept. A `CHECK` constraint
enforces that pairing (`pending` ⟺ `user_id IS NULL`).

### `roles`
`company_id IS NULL` = a built-in system role (Owner, Admin, Accountant,
Payroll Admin, Employee, Viewer — seeded in `db/seeds/01_reference_data.sql`)
available to every company. `company_id` set = a custom role belonging to
exactly one company. Two partial unique indexes enforce name-uniqueness
correctly within each of those two worlds (a plain `UNIQUE (company_id,
name)` would incorrectly treat every global role's `NULL` company_id as
distinct, allowing duplicate global role names — the partial indexes close
that gap).

### `permissions`
A fixed, platform-defined catalog (`key` like `payroll.approve`). Rows are
managed by the application/deploy process, not end users — there's
deliberately no `company_id` here at all; permissions are a global system
concept, not something a company owns.

### `role_permissions`
Junction: which permissions a role grants. No `company_id` (a permission
grant is scoped by its `role_id`, which itself may be global or
company-scoped) and no soft delete (removing a permission from a role is a
real, immediate removal — if you need history of that change, it belongs
in `audit_logs`, not a tombstoned junction row).

### `user_roles`
Assigns one role to one user **within one company** — `company_id` is
denormalized here even though it's derivable via `role_id`/membership,
for the same query-convenience reason as elsewhere. A trigger
(`check_user_role_assignment`) enforces two integrity rules the FK columns
alone can't express: the user must have an *active* `company_membership`
in that company, and a company-scoped (non-global) role can only be
assigned within its own company.

---

## Organization (`0005`)

### `departments`
Soft-deleted, never hard-deleted: `employment_records` and payroll history
reference a department long after it's deactivated.

### `employees`
The employee master record. `user_id` is nullable — an employee doesn't
necessarily have platform self-service login access. **Not hard-deletable**
in practice: `payroll_entries`, `employment_records`, etc. reference it with
plain (`RESTRICT`-by-default) foreign keys, so the database itself refuses
to delete an employee with payroll history. `deleted_at` exists only for
"this record was created in error" corrections — it is **not** how you
represent someone leaving the company. That's `termination_date` (a real
business fact) plus `employment_status = 'terminated'`; the row stays fully
intact, non-deleted, forever.

`departments.manager_employee_id` and `employees.department_id` reference
each other. The migration resolves this by creating `departments` first
(without that one FK), then `employees`, then adding the manager FK via
`ALTER TABLE` once both tables exist — a standard pattern for circular
references, not a design compromise.

`date_of_birth` is flagged as sensitive PII in a column comment; see
`security-risks.md` for encryption/handling guidance shared with the
similarly sensitive columns below.

---

## Employee details (`0006`)

### `employee_addresses`
At most one `home` and one `mailing` address per employee (enforced by
`UNIQUE (employee_id, address_type)`). Hard-deletable — nothing downstream
references a specific address row, so there's no historical reason to keep
a superseded one.

### `employee_bank_accounts`
Soft-deleted, not hard-deleted: `payroll_entries.bank_account_id` snapshots
*which* account a specific historical paycheck was deposited to, and that
reference must remain valid even after the employee changes or removes the
account. `account_number_encrypted`/`routing_number_encrypted` hold
application-encrypted ciphertext — **Postgres does not encrypt these
automatically**; the app's encryption service (or an external KMS/envelope
encryption) must produce the ciphertext, and the key must never be stored
in this database. `account_number_last4` is deliberately plaintext, so the
UI can show "•••• 1234" without ever decrypting the full number for
display.

### `employee_tax_profiles`
**Append-only, time-sliced history**, not a table you `UPDATE`. A "change"
in withholding elections is a new row with a later `effective_date`; the
"current" profile for any date is whichever row has the latest
`effective_date <= that date`. This isn't a convention the application is
trusted to follow — a trigger (`prevent_update_delete`, shared with
`audit_logs`) makes every row immutable the instant it's inserted, no
exceptions, no approval step required first. `tax_id_encrypted` follows the
same encryption approach as bank account numbers.

### `employment_records`
Same append-only pattern as tax profiles, for job title/department/pay-rate
history (hires, promotions, transfers). The employee's *current* pay rate
and title are whichever row has the latest `effective_date`. Also
unconditionally immutable via `prevent_update_delete`.

---

## Payroll core (`0007`) — the schema's strictest immutability rules

### `payroll_periods`
A pay-period window (e.g. Jul 1–15) shared by every `payroll_runs` row
generated for it.

### `payroll_runs`
One batch of paychecks for one period. **Financial totals and identity
fields are locked the moment `status` becomes `'approved'`, and the entire
row becomes fully immutable the moment `status` becomes `'paid'`** — no
column may change, full stop, enforced by `check_payroll_run_immutable()`.
An approved-but-not-yet-paid run may still move to `paid` or `cancelled`,
nothing else. **Deleting a `payroll_runs` row is blocked outright once its
status is `approved` or `paid`.** Correcting a mistake after approval is
done with a *new* run (`run_type = 'correction'`), never by editing history
— this mirrors how real payroll compliance requires the trail of what was
actually approved and paid to stay intact.

### `payroll_entries`
One employee's paycheck within a run. `bank_account_id` is a point-in-time
snapshot (see `employee_bank_accounts` above). Same immutability shape as
`payroll_runs`, enforced by `check_payroll_entry_immutable()`: financial
fields and identity columns lock at `approved`, the row is fully frozen and
undeletable at `paid`.

---

## Payroll line items (`0008`)

### `earning_types`, `deduction_types`, `benefit_types`
Three parallel reference tables, all following the same
global-vs-company-scoped pattern as `roles`: `company_id IS NULL` = a
platform default (Regular, Overtime, 401k, Health Insurance, ...),
`company_id` set = a company's own custom type. Soft-deleted so a
deactivated type doesn't break historical rows that still reference it.

### `employee_earnings`, `employee_deductions`, `employee_benefits`
**The one design decision in this schema that isn't obvious from the table
names alone, so it's spelled out here in full:**

- **`employee_earnings` is always transactional** — every row belongs to
  exactly one `payroll_entries` row (`payroll_entry_id NOT NULL`). An
  earning like overtime or a bonus is never a standing "election" the way
  a benefit enrollment is; it only ever exists as part of one specific
  paycheck.
- **`employee_deductions` and `employee_benefits` are dual-purpose**,
  distinguished by whether `payroll_entry_id` is `NULL`:
  - **`NULL`** → a standing recurring election/enrollment (e.g. "this
    employee has a standing $50/paycheck 401k deduction going forward").
    Ordinary master data, soft-deletable at any time by the employee or an
    admin cancelling the election.
  - **set** → the concrete amount actually applied to *that one* paycheck
    (either generated from a template election or a one-off adjustment).
    Immutable the moment its parent `payroll_entries` row is approved or
    paid — same rule as `employee_earnings`.

  This means these two tables serve both as "what is this employee enrolled
  in" (query `WHERE payroll_entry_id IS NULL`) and "what actually appeared
  on paycheck X" (query `WHERE payroll_entry_id = X`) without a fourth pair
  of "template" tables.

All three tables' applied-instance rows are protected by triggers
(`check_employee_earnings_immutable`, `check_employee_deductions_immutable`,
`check_employee_benefits_immutable`) that check the parent
`payroll_entries.status` via a shared helper function
(`check_payroll_line_immutable_via_entry`) — template rows
(`payroll_entry_id IS NULL`) are never subject to this check, since they
aren't tied to any specific paycheck yet.

---

## Sales (`0009`, `0010`)

### `customers`, `vendors`
Soft-deleted only: historical invoices, payments, and expenses must keep
referencing a valid row even after the business relationship ends. Each has
a partial unique index on `(company_id, email)` for non-deleted rows with a
non-null email — so re-adding a customer under the same email after a soft
delete doesn't collide with the tombstoned row.

### `invoices`
**Only a draft invoice may be edited or have its billed amounts changed;
only a draft invoice may be deleted at all.** The moment `status` leaves
`'draft'` (→ `sent`, `paid`, etc.), `check_invoice_immutable()` locks
`customer_id`, `currency`, `subtotal`, `tax_total`, `total`, `issue_date`,
and `invoice_number`. `status`, `due_date`, `amount_paid`, and `notes`
remain updatable after sending — those are legitimate ongoing bookkeeping
fields (status transitions, payments arriving, a due-date extension), not
the billed amount itself.

### `invoice_items`
`amount` is a **generated column** (`quantity * unit_price`) — it is
computed by Postgres itself and can never drift from its inputs by
application bug. Line items can only be inserted, edited, or deleted while
the parent invoice is still a draft (`check_invoice_items_immutable`,
checked on `INSERT` too, not just `UPDATE`/`DELETE` — you cannot add a new
line item to an already-sent invoice any more than you can edit an
existing one).

### `payments`
**The strictest immutability rule in the non-payroll schema.** A payment
row, once created, is fully immutable except for one field: `voided_at` may
be set exactly once (from `NULL` to a timestamp) and never changed again.
**No payment row may ever be hard-deleted, under any status, permanently**
— a mistaken payment is corrected by voiding it and recording a new
offsetting/replacement payment, never by editing or removing the original
financial fact.

---

## Expenses (`0011`)

### `expense_categories`
Same global-vs-company-scoped, soft-deleted pattern as `earning_types`.

### `expenses`
Editable/deletable while `status = 'pending'`; the moment it's `approved`,
`reimbursed`, or `rejected`, `check_expenses_immutable()` locks `amount`,
`currency`, `vendor_id`, `expense_category_id`, and `date`, and blocks
deletion entirely.

---

## General ledger (`0012`) — the schema's core double-entry integrity

### `chart_of_accounts`
Self-referencing (`parent_account_id`) to support a sub-account hierarchy
(1000 Cash → 1010 Checking). **Balances are never stored on this table** —
see "Derived vs. stored balances" below. Soft-deleted, and in practice an
account with any posted `journal_entry_lines` should be deactivated
(`is_active = false`) rather than deleted at all — deactivate, don't delete,
once an account has real history.

### `journal_entries`
The core double-entry ledger. `source_type`/`source_id` are an
application-enforced *polymorphic* reference to whatever generated the
entry (an invoice, a payment, a payroll run, or a manual entry) — not a
database foreign key, since it can point to different tables; the
application is responsible for this integrity, the same way `documents`
and `audit_logs`' polymorphic references are.

**Once `status = 'posted', the row is permanently immutable — no `UPDATE`,
no `DELETE`, ever, for any reason**, enforced by
`check_journal_entry_immutable()`. This is the one rule in the whole schema
with zero exceptions: a mistake in a posted entry is corrected only by
posting a **new reversing entry**, exactly as real double-entry accounting
requires. The same trigger also **refuses to let an entry be posted at all
unless its lines are balanced** (`SUM(debit) = SUM(credit)`) and non-empty —
this is checked at the moment of the `draft → posted` transition, not left
to the application to remember.

### `journal_entry_lines`
Each line is a debit *or* a credit, never both, never neither (a `CHECK`
constraint enforces this at the row level; the *entry-level* balance check
above lives in the trigger because it's a cross-row aggregate). Lines lock
the instant their parent entry posts (`check_journal_entry_lines_immutable`,
checked on `INSERT` too).

---

## Banking (`0013`)

### `bank_accounts`
A company's *own* bank account (distinct from `employee_bank_accounts`,
which exist to pay employees). `chart_of_account_id` links it to its GL
cash account.

### `bank_transactions`
`amount` follows the standard bank-feed sign convention (positive =
deposit, negative = withdrawal). `external_transaction_id` is the dedupe
key from a bank-feed integration (Plaid or similar) — a partial unique
index on `(bank_account_id, external_transaction_id)` makes repeated
imports idempotent. **Locked once `reconciled = true`**
(`check_bank_transactions_immutable`): amount, date, and account can't
change, and the row can't be deleted.

---

## Supporting tables (`0014`)

### `documents`
Metadata only — actual file bytes belong in object storage (S3 or
equivalent) at `storage_path`; this table is never used to store a blob
directly. `owner_type`/`owner_id` are a polymorphic reference, same pattern
as `journal_entries.source_type/source_id`. Soft-deleted: deleting here
records intent, and a background job removes the underlying object
separately, preserving the "who uploaded what, when" trail.

### `audit_logs`
**Append-only, no exceptions, enforced two independent ways.** First, a
`BEFORE UPDATE OR DELETE` trigger (`prevent_update_delete`) rejects any
attempt to change or remove a row. Second — belt and suspenders, added in
migration `0015` — the application's own database role
(`nerobooks_app`) is never granted `UPDATE` or `DELETE` on this table at
all, so even a connection with no trigger protection (or a future migration
that accidentally drops the trigger) still can't touch existing audit rows,
because the privilege to attempt it doesn't exist. This is the only table
with no `updated_at` and no `deleted_at` by design — nothing here is ever
mutated, so a column implying it might be would be actively misleading.

### `notifications`
The one table in this entire schema with **no special retention rule at
all**. Ephemeral, no compliance/historical value once read and old — hard
`DELETE` (e.g. from a periodic cleanup job removing old read notifications)
is completely fine here, unlike literally everywhere else in this document.

### The application database role (`0015`)
`nerobooks_app` is the role the application should actually connect as —
never the migration-running superuser. It's granted `SELECT, INSERT,
UPDATE, DELETE` on every table except `audit_logs` (`SELECT, INSERT` only),
with `ALTER DEFAULT PRIVILEGES` ensuring any table added by a later
migration inherits the same grants automatically. No password is set in the
migration — that must be configured out-of-band (secrets manager, or your
cloud provider's IAM-based Postgres auth), never committed to version
control.

---

## Deliberate exceptions to "company_id on every table"

Four tables have no `company_id`, and each is a deliberate exception, not
an oversight:

| Table | Why no `company_id` |
|---|---|
| `companies` | It *is* the tenant root — nothing to scope it to. |
| `users`, `user_profiles` | Platform-wide identity by design (one person, many companies via `company_memberships`) — see "Identity" above. |
| `permissions` | A fixed, global system catalog — permissions aren't owned by any company. |
| `role_permissions` | A junction between two entities that may themselves be global (`roles.company_id IS NULL`); scoping is inherited transitively through `role_id`. |

Every other table — including every line-item/detail table one join away
from its parent — carries `company_id` directly.

## Indexing decisions

- **Every foreign key column has an explicit index.** Postgres does *not*
  automatically index foreign key columns (only the referenced side's
  primary/unique key gets one for free) — every `REFERENCES` in this schema
  has a matching `CREATE INDEX`, because an unindexed FK column means both
  slow joins and slow `ON DELETE CASCADE`/`RESTRICT` checks.
- **Every `company_id` column has an index**, usually as the leading column
  of a composite index alongside whatever that table is most often filtered
  by next (`company_id, status`, `company_id, due_date`, `company_id,
  entry_date`) — the dominant query shape in a multi-tenant app is always
  "this company's records, filtered by something else."
- **Partial indexes (`WHERE deleted_at IS NULL`) on every soft-deletable
  table's main lookup indexes**, so routine queries (which almost always
  exclude soft-deleted rows) scan a smaller, more cache-friendly index, and
  uniqueness constraints on things like email only apply among *live* rows.
- **Partial unique indexes for the "global vs. company-scoped" pattern**
  (`roles`, `earning_types`, `deduction_types`, `benefit_types`,
  `expense_categories`) — a plain `UNIQUE (company_id, code)` cannot express
  "unique among the global rows" and "unique per company" simultaneously,
  because SQL `NULL` is never equal to another `NULL` in a uniqueness
  check; two partial indexes (`WHERE company_id IS NULL` /
  `WHERE company_id IS NOT NULL`) are the correct tool.
- **Composite indexes ordered by selectivity/access pattern**, e.g.
  `(employee_id, effective_date DESC)` on the append-only history tables,
  matching the "give me the current record" query
  (`ORDER BY effective_date DESC LIMIT 1`) directly.
- **147 indexes total** across 39 tables as of this schema (verified by
  querying `pg_indexes` against the applied migrations) — this is
  intentionally index-heavy for a schema whose read pattern is dominated by
  "this company's X, filtered by Y," which is exactly what multi-tenant
  SaaS accounting/payroll workloads look like. Revisit if `EXPLAIN ANALYZE`
  on real production query patterns ever shows an index going unused; don't
  preemptively remove any of these based on guesswork.

## Derived vs. stored balances

**Deliberately not implemented as a stored column anywhere in this
schema.** `chart_of_accounts` and `customers`/`vendors` have no `balance`
column. Compute on read:

```sql
-- Account balance
SELECT coalesce(sum(debit) - sum(credit), 0)
FROM journal_entry_lines
WHERE account_id = $1;

-- Customer balance (open invoices)
SELECT coalesce(sum(i.total - i.amount_paid), 0)
FROM invoices i
WHERE i.customer_id = $1 AND i.status IN ('sent', 'partially_paid', 'overdue');
```

A stored `balance` field that every write path must remember to keep in
sync is exactly the kind of thing that silently drifts from reality in a
real ledger. If read performance ever genuinely requires it, add a
materialized view or a trigger-maintained cached column later — starting
correct and optimizing only when proven necessary is the right order, not
the reverse.

## Data-retention considerations

- **Soft-deleted rows are not a retention policy by themselves** — this
  schema's `deleted_at` marks a row as logically gone from day-to-day views,
  but nothing here automatically purges old soft-deleted rows. Decide (and
  automate, outside this schema, e.g. via a scheduled job) how long
  soft-deleted `customers`, `vendors`, `employees`, etc. are kept before
  genuine hard deletion — this is a legal/compliance question (payroll and
  tax records commonly need multi-year retention in most jurisdictions) as
  much as a technical one, and this project isn't the place to guess at a
  number for you.
- **`audit_logs` will grow without bound** by design — it's the one table
  explicitly meant to never lose history. Plan for partitioning (e.g. by
  month, via native Postgres declarative partitioning) once volume warrants
  it, rather than deleting audit history to manage size.
- **`notifications` is the opposite** — actively plan to prune old, read
  rows on a schedule; there's no reason to let this table grow forever.
- **Encrypted PII columns** (`employee_bank_accounts.account_number_encrypted`,
  `employee_tax_profiles.tax_id_encrypted`, and the equivalents on
  `bank_accounts`) need their *own* retention/deletion policy tied to
  whatever regulation applies to the data (e.g. deleting bank details a
  set period after an employee's termination, if your jurisdiction permits
  or requires that) — this schema stores them safely (encrypted, isolated
  from the plaintext `_last4` display columns) but does not decide *when*
  they must be purged; that's a product/legal decision layered on top.
- **Never seed or test against real personal or financial data** — see
  `db/seeds/02_dev_example_company.sql`'s header for the concrete
  placeholder conventions used throughout this project (fake names,
  `DEV-SEED-PLACEHOLDER-NOT-REAL-CIPHERTEXT` in place of ciphertext, `0000`
  in place of real last-4 digits).

## Which records must be immutable after approval — the complete list

| Table | Locks when | What's locked |
|---|---|---|
| `payroll_runs` | `status = 'approved'` | Financial totals, `payroll_period_id`, `company_id`, `created_by`/`created_at`. Row fully frozen (nothing may change, not even status) once `status = 'paid'`. Delete blocked at `approved` or `paid`. |
| `payroll_entries` | `status = 'approved'` | All financial fields, `employee_id`, `payroll_run_id`, `bank_account_id`. Fully frozen at `'paid'`. Delete blocked at `approved` or `paid`. |
| `employee_earnings` | parent `payroll_entries.status ∈ {approved, paid}` | Entire row (any `UPDATE`/`DELETE`). |
| `employee_deductions`, `employee_benefits` | same, **only when `payroll_entry_id IS NOT NULL`** (an applied instance, not a standing template) | Entire row. |
| `employee_tax_profiles`, `employment_records` | **immediately upon creation**, unconditionally | Entire row, forever — append-only by design, no approval step needed to trigger it. |
| `invoices` | `status ≠ 'draft'` | `customer_id`, `currency`, `subtotal`, `tax_total`, `total`, `issue_date`, `invoice_number`. Delete blocked once not draft. |
| `invoice_items` | parent `invoices.status ≠ 'draft'` | Entire row, including `INSERT` of new items. |
| `payments` | **immediately upon creation**, unconditionally | Everything except one one-time `voided_at` write. Delete never permitted, under any status. |
| `expenses` | `status ∈ {approved, reimbursed, rejected}` | `amount`, `currency`, `vendor_id`, `expense_category_id`, `date`. Delete blocked once not pending. |
| `journal_entries` | `status = 'posted'` | Entire row, unconditionally, forever. Delete never permitted once posted. |
| `journal_entry_lines` | parent `journal_entries.status = 'posted'` | Entire row, including `INSERT` of new lines. |
| `bank_transactions` | `reconciled = true` | `amount`, `transaction_date`, `bank_account_id`. Delete blocked once reconciled. |
| `audit_logs` | **immediately upon creation**, unconditionally | Entire row, forever — plus no grant to even attempt `UPDATE`/`DELETE` (see `0015`). |

Every row in the table above is backed by a trigger in the migrations and
exercised by a real `INSERT`/`UPDATE`/`DELETE` attempt in
`db/tests/verify_immutability.sql` — this list is a description of tested
behavior, not an aspiration.

## Verification

Everything in this document was checked against a real PostgreSQL 16
instance while building it, not just written and assumed correct:

- All 15 migrations apply cleanly, in order, to a fresh database.
- All 15 `.down.sql` files roll back cleanly in reverse order, leaving zero
  tables and zero functions behind.
- `db/tests/verify_immutability.sql` exercises every row of the table above
  with real data and confirms each blocked action actually raises, and that
  the specific allowed exceptions (status transitions, `voided_at`,
  invoice `notes`) actually succeed.
- `db/seeds/01_reference_data.sql` and `02_dev_example_company.sql` both run
  cleanly and are idempotent (verified by running each twice).
- No `real`/`double precision` column exists anywhere in the schema
  (queried directly against `information_schema.columns`).
- Every table has `created_at`; every table except the documented
  `audit_logs` exception has `updated_at` (also queried directly, not
  eyeballed).

## Migration and rollback instructions

Full commands are in [`db/README.md`](../db/README.md). Summary:

```bash
# Apply, in order:
for f in db/migrations/*.up.sql; do psql -d nerobooks -v ON_ERROR_STOP=1 -f "$f"; done

# Roll back, in reverse order:
for f in $(ls db/migrations/*.down.sql | sort -r); do psql -d nerobooks -v ON_ERROR_STOP=1 -f "$f"; done

# Seed (reference data everywhere, example company in dev only):
psql -d nerobooks -f db/seeds/01_reference_data.sql
psql -d nerobooks -f db/seeds/02_dev_example_company.sql   # dev/local only

# Regression-check every immutability rule:
psql -d nerobooks -f db/tests/verify_immutability.sql
```

**Rollback is destructive.** A `down` migration drops tables — and any data
in them — not just schema. Never run one against an environment with real
data unless you have a verified backup and specifically intend to remove
that data. In a real deployment pipeline, prefer forward-only migrations
(a new migration that fixes a problem) over rolling back a shipped one,
the same way `journal_entries` prefers a reversing entry over editing
history — it's the same principle applied to the schema itself.
