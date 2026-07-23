# NeroBooks production database

Plain, ordered SQL migrations for PostgreSQL — no ORM, no migration
framework dependency. Each migration is a paired `NNNN_name.up.sql` /
`NNNN_name.down.sql`. Apply `.up.sql` files in ascending numeric order;
roll back `.down.sql` files in descending order.

Full schema documentation, entity relationships, and rationale live in
[`docs/database-schema.md`](../docs/database-schema.md). This file only
covers *how to run things*.

## Layout

```
db/
├── migrations/     15 paired .up.sql / .down.sql files, numbered in order
├── seeds/          01_reference_data.sql (run everywhere) and
│                   02_dev_example_company.sql (dev/local only — fake data)
├── tests/          verify_immutability.sql — a manual regression check
│                   for every "must not be editable after approval" rule
└── README.md       this file
```

## Requirements

- PostgreSQL 13+ (uses `gen_random_uuid()`; enables `pgcrypto` and `citext`
  via `CREATE EXTENSION`, which requires a role with `CREATEDB`/superuser
  privileges the first time — typically fine on a fresh database you own).

## Apply all migrations to a fresh database

```bash
createdb nerobooks

for f in db/migrations/*.up.sql; do
  psql -d nerobooks -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED: $f"; break; }
done
```

(On Windows/PowerShell, loop with `Get-ChildItem db/migrations/*.up.sql |
Sort-Object Name | ForEach-Object { psql -d nerobooks -v ON_ERROR_STOP=1 -f $_.FullName }`.)

Any real migration runner that just executes ordered SQL files works too
(dbmate, golang-migrate, graphile-migrate, or a thin custom script) — these
files don't depend on any specific tool's metadata table.

## Roll back

Apply `.down.sql` files in **reverse** numeric order:

```bash
for f in $(ls db/migrations/*.down.sql | sort -r); do
  psql -d nerobooks -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED: $f"; break; }
done
```

Rolling back a migration drops the tables/functions/triggers it created.
**This is destructive** — a `down` migration for a table with real rows
deletes that data along with the table. Never run a `down` migration
against a database with real production data unless you have a verified
backup and specifically intend to remove that data.

## Seed data

```bash
# Every environment, including production — catalog/reference data only,
# no personal or financial information:
psql -d nerobooks -v ON_ERROR_STOP=1 -f db/seeds/01_reference_data.sql

# Local development only — a fictional example company with fake people,
# fake invoices, fake (placeholder, non-functional) bank details:
psql -d nerobooks -v ON_ERROR_STOP=1 -f db/seeds/02_dev_example_company.sql
```

Both seed scripts are idempotent — re-running them is a safe no-op.

After seeding the dev example company, you can sign in locally as
`owner@example.com` or `accountant@example.com` with password
`devpassword123` (a real bcrypt hash is seeded via pgcrypto so this
actually verifies — see the seed file's header comment for why that
password/hash approach is dev-only and must not carry over to real auth).

## Running the immutability regression check

```bash
psql -d nerobooks -v ON_ERROR_STOP=1 -f db/tests/verify_immutability.sql
```

Wrapped in `BEGIN; ... ROLLBACK;`, so it never leaves data behind. A
passing run ends with `--- ALL IMMUTABILITY CHECKS PASSED ---`; anything
printed as `TEST SETUP FAILED` means a trigger stopped enforcing a rule it
should — re-run this after touching any trigger function in `migrations/`.

## Adding a new migration later

1. Create `00NN_description.up.sql` and the matching `.down.sql`, with `N`
   one higher than the current last migration.
2. Every company-owned table gets `company_id uuid NOT NULL REFERENCES
   companies (id) ON DELETE CASCADE` plus an index on it, `created_at`/
   `updated_at timestamptz` (with the `set_updated_at()` trigger from
   migration `0001` attached), and — if it holds money — `numeric(19,4)`,
   never `real`/`double precision`/floating point.
3. If the table represents a financial record that becomes final after some
   approval step (a new report type, a new kind of ledger-affecting record,
   etc.), add an immutability trigger following the pattern in
   `0007_payroll_core.up.sql` or `0012_general_ledger.up.sql` — check the
   status transition, block the specific columns/operations that must not
   change, and say so in a table comment.
4. Apply your new `.up.sql` against a scratch database and confirm the
   matching `.down.sql` cleanly reverses it before committing either.
