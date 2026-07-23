# NeroBooks — Current Architecture Assessment

Status: **frontend-only demo/prototype**. There is no backend, no database, and no
real authentication anywhere in this codebase. Every "account," "invoice," and
"team" is a JavaScript object living in the browser's `localStorage`.

This document is a factual inventory of what exists today, as of the current
`main` branch. It does not propose changes — see `backend-roadmap.md` for that.

---

## 1. Frontend framework and version

| Package | Version |
|---|---|
| React | ^19.2.7 |
| React DOM | ^19.2.7 |
| React Router (`react-router-dom`) | ^7.18.1 |
| Recharts (charts) | ^3.9.2 |
| TypeScript | ~6.0.2 |
| Vite (build tool) | ^8.1.1 |
| @vitejs/plugin-react | ^6.0.3 |
| oxlint (linter) | ^1.71.0 |

Build tool is Vite with the standard React + TypeScript template (`tsc -b && vite
build`). No server-side rendering, no meta-framework (no Next.js/Remix) — this is
a client-side single-page app (SPA) built to static files.

`package.json` has no `"engines"` field (no pinned Node version) and no test
script — `npm run lint` exists but there is no test runner configured at all.

## 2. Routing system

- **`react-router-dom` v7**, using **`HashRouter`** (not `BrowserRouter`). URLs
  look like `https://.../NeroBooks/#/invoices`. This was chosen because the app
  is deployed to GitHub Pages as a static site with no server-side rewrite
  rules — `HashRouter` avoids 404s on refresh without needing a Pages-specific
  rewrite trick.
- Routing is defined in `src/App.tsx`. There is exactly one nested route tree:

  ```
  / (Layout)
  ├── /            → Dashboard
  ├── /invoices     → Invoices
  ├── /customers    → Customers
  ├── /expenses     → Expenses
  ├── /vendors      → Vendors
  ├── /accounts     → Accounts        (Chart of Accounts)
  ├── /transactions → Transactions    (ledger register)
  ├── /reports      → Reports
  ├── /team         → Team
  └── /billing      → Billing
  ```

- **There is no route-level access control.** Auth is gated at the top:
  `AuthGate` in `App.tsx` checks `useAuth().user` and renders the entire
  `<SignIn />` page in place of the router output if there's no user — it does
  not redirect, and there's no route the user can visit while logged out other
  than the sign-in screen. Once logged in, every route above is open; nothing
  currently restricts a route by plan (routes render, but content inside pages
  is conditionally locked — see §13/§14).
- No 404/not-found route is defined.

## 3. Folder and file structure

```
NeraBooks/                        (local folder name — kept for historical reasons;
                                    app/repo are branded "NeroBooks")
├── .github/workflows/deploy.yml  GitHub Pages CI/CD (see §12)
├── docs/                         This assessment
├── public/
│   ├── favicon.svg
│   └── icons.svg                 (leftover from Vite template, unused by app code)
├── src/
│   ├── main.tsx                  React root mount
│   ├── App.tsx                   Provider tree + router
│   ├── index.css                 Entire app's styling (single global stylesheet)
│   ├── types.ts                  All domain types (Invoice, Customer, Vendor, …)
│   ├── components/                Reusable, mostly presentational
│   │   ├── Layout.tsx             App shell: header, sidebar nav, dropdowns
│   │   ├── Modal.tsx               Generic modal shell
│   │   ├── StatusBadge.tsx         Invoice status pill
│   │   ├── icons.tsx               Hand-rolled inline SVG icon set
│   │   ├── NewMenu.tsx             "+ New" header dropdown
│   │   ├── UserMenu.tsx            Avatar dropdown (plan, currency, sign out)
│   │   ├── CurrencyPicker.tsx      Searchable currency list
│   │   ├── CountryPicker.tsx       Searchable country list (buy-flow)
│   │   ├── Pricing.tsx             3-plan pricing cards (buy-flow)
│   │   ├── FeatureMatrix.tsx       Collapsible full feature-comparison table
│   │   └── UpgradeBanner.tsx       Locked-feature upsell banner
│   ├── context/                   All app state lives here (no external store lib)
│   │   ├── AuthContext.tsx         Fake auth + plan, persisted to localStorage
│   │   ├── DataContext.tsx         Customers/vendors/invoices/expenses/accounts/
│   │   │                          transactions, persisted to localStorage
│   │   ├── CurrencyContext.tsx     Selected display currency, persisted
│   │   └── TeamContext.tsx         Invited team members, persisted
│   ├── lib/                       Pure data/helpers, no React
│   │   ├── seed.ts                 Hard-coded demo records (see §7)
│   │   ├── currencies.ts           ~170 ISO 4217 currencies (code/name/symbol)
│   │   ├── countries.ts            ~195 countries → default currency
│   │   ├── exchangeRates.ts        Static USD exchange-rate table + converters
│   │   ├── featureMatrix.ts        Full plan/feature matrix (source of truth)
│   │   ├── planLimits.ts           Derives gating flags from featureMatrix.ts
│   │   ├── plans.ts                3 pricing-card definitions (EasyStart/Plus/Advanced)
│   │   ├── trend.ts                Hard-coded 6-month income/expense series +
│   │   │                          naive linear forecast projection
│   │   └── format.ts               currency()/formatDate()/initials() helpers
│   └── pages/                     One file per route
│       ├── SignIn.tsx              Sign-in + full "buy now" wizard (see §4)
│       ├── Dashboard.tsx
│       ├── Invoices.tsx
│       ├── Customers.tsx
│       ├── Expenses.tsx
│       ├── Vendors.tsx
│       ├── Accounts.tsx            Chart of Accounts
│       ├── Transactions.tsx        General ledger register
│       ├── Reports.tsx             P&L, Balance Sheet, Cash Flow, Budget, Forecast
│       ├── Team.tsx
│       └── Billing.tsx
├── index.html
├── vite.config.ts                 base: '/NeroBooks/' (GitHub Pages subpath)
├── tsconfig*.json
└── package.json / package-lock.json
```

Notes:
- The local disk folder is still named `NeraBooks` (a prior rename to `NeroBooks`
  was blocked by a file lock and skipped as cosmetic-only — see git history). It
  has no effect on the app, repo name, or deployed URL.
- `public/icons.svg` is a leftover Vite template asset; nothing in `src/`
  references it (the app's own icon set lives in `src/components/icons.tsx`).
- README.md at the repo root is still the **unedited default Vite template
  README** — it documents Vite/Oxlint, not NeroBooks itself.

## 4. Login, registration, and password-reset pages

All in **`src/pages/SignIn.tsx`** — one file, four internal steps driven by
local component state (`step: "signin" | "country" | "pricing" | "checkout"`),
not separate routes:

- **Sign in** (`step: "signin"`): email + password fields. On submit, *the
  password is never checked or even read* — any non-empty email/password pair
  logs the user in as plan `"easystart"`, with the display name derived from
  the email's local part (`email.split("@")[0]`). The UI is honest about this:
  it shows the text "This is a demo — any email & password will work."
- **Registration** ("Buy now" flow): a 3-step wizard —
  1. **Pick your country** (`CountryPicker`, ~195 countries)
  2. **Choose your plan** (`Pricing`, 3 tiers, prices converted to the picked
     country's currency via the static rate table)
  3. **Create your account** (`step: "checkout"`): name + email + password.
     Same as sign-in — password is captured in a controlled input but **never
     stored, hashed, or sent anywhere**. Submitting calls `signIn()` with the
     chosen plan and sets the app's display currency to the picked country's
     currency.
- **Password reset**: **does not exist.** No "Forgot password?" link, no
  reset-token flow, no email-sending of any kind.

Because there's no real password anywhere, there is also no session/token
concept — "being signed in" is just `AuthContext`'s `user` object being
non-null, persisted as plaintext JSON in `localStorage["nerobooks-auth"]`.

## 5. Accounting and payroll screens

**Accounting screens that exist** (all under the authenticated `Layout`):
- **Dashboard** — stat tiles (outstanding/overdue/paid invoices, total
  expenses), income-vs-expenses bar chart, expenses-by-category donut, recent
  invoices table.
- **Invoices** — list + filter by status, creation modal (customer, currency,
  recurring flag, line items). No edit or delete of an existing invoice.
- **Customers** — list + creation modal. No edit or delete.
- **Expenses** — list + creation modal (vendor, category, amount, payment
  method). No edit or delete.
- **Vendors** — list + creation modal. No edit or delete.
- **Chart of Accounts** — read-only list of 6 seeded accounts (Asset/
  Liability/Equity/Income/Expense) with balances. No create/edit UI at all.
- **Transactions** — read-only general-ledger register of seeded entries. No
  create/edit UI.
- **Reports** — Profit & Loss, Balance Sheet, Cash Flow, Budgeting, Forecast
  tabs (availability gated by plan — see §14), plus a CSV export button
  (Advanced plan only).

**Payroll: no screen exists.** "Payroll" appears only as one fixed string in
the `ExpenseCategory` union type (`src/types.ts`) and as a category label a
user can pick when logging a manual expense — there is no payroll run, no
employee records, no pay stubs, no tax withholding, nothing beyond that one
category name.

## 6. Forms and validation

There is **no validation library** anywhere (no Zod, Yup, React Hook Form,
Formik). Every form is hand-rolled `useState` + a plain `<form onSubmit>` or
button `onClick`, with validation limited to:

- **Non-empty checks** via `.trim()` — e.g. `if (!name.trim() || !email.trim())
  return;` (Customers, Vendors, SignIn). Failing the check silently does
  nothing (SignIn is the only place that also sets a visible `error` string;
  the others just no-op).
- **Numeric coercion** — `Number(amount)` (Expenses), `Number(e.target.value)`
  for invoice line-item qty/rate. `Number("")` → `NaN`, which the `!value`
  falsy-check happens to catch, but there's no explicit NaN/negative guard.
- **HTML5 native attributes only** — `type="email"` on some email inputs
  (SignIn) but not others (Customers' and Vendors' email fields are plain
  `type="text"`, so `notanemail` is accepted); `type="number" min={0}` on
  amount/qty/rate fields, which is a browser-level soft clamp only, not
  enforced in JS if bypassed (e.g. via devtools or a non-browser client hitting
  a future API).
- **No format validation** for email, phone, currency amounts, or dates beyond
  what the browser's native `<input type="...">` widgets provide.
- **No duplicate detection** — nothing stops creating two customers with the
  identical email, two invoices with the same number, etc.

## 7. Mock data, hard-coded data, and temporary data

Everything is either seeded once or computed client-side:

| File | Contents |
|---|---|
| `src/lib/seed.ts` | Hard-coded arrays: 4 customers, 4 vendors, 5 invoices, 6 expenses, 6 chart-of-accounts entries, 6 ledger transactions. This is the **only** "database" the app has — copied into `localStorage` on first load, then mutated in place. |
| `src/lib/currencies.ts` | ~170 currencies, hand-typed code/name/symbol. |
| `src/lib/countries.ts` | ~195 countries, hand-typed name/ISO code/default currency. |
| `src/lib/exchangeRates.ts` | Static USD exchange rates ("for demo/display purposes only — not wired to a live rates feed", per its own comment). Never updates; not tied to any date. |
| `src/lib/trend.ts` | A fixed 6-month `{month, income, expenses}` array used by both the Dashboard chart and the Reports "Forecast" tab. The forecast is explicitly labeled "Naive projection... Not a predictive model" in the UI. |
| `src/lib/featureMatrix.ts` / `planLimits.ts` / `plans.ts` | Static plan/pricing/feature data — not mock in the sense of "fake records," but it is all compile-time constant, not configurable at runtime or by an admin. |
| `src/context/TeamContext.tsx` | Starts empty (`[]`); the signed-in user is always shown as "Owner" but is **not itself stored** as a team record — it's derived live from `AuthContext`. |

All of the above is either genuinely static (currencies, countries, exchange
rates, feature matrix) or is mutable "seed data" that only ever lives in one
browser's `localStorage` — there is no shared, server-side source of truth, so
two people/devices see completely independent app states.

## 8. API routes or server functions

**None exist.** This is a 100%-static site:

- No `fetch()`, `axios`, `XMLHttpRequest`, or `import.meta.env` usage anywhere
  in `src/` (verified by full-tree search).
- No `/api` folder, no server entry point, no serverless functions.
- The only "network" behavior in the app is the CSV export on the Reports page,
  which builds a `Blob` client-side and triggers a browser download — no
  request ever leaves the browser.
- GitHub Pages (the deployment target — see §12) only serves static files; it
  cannot run server code even if some were added.

## 9. Environment-variable setup

**None.** No `.env`, `.env.local`, `.env.production`, etc. exist in the repo
(confirmed absent), and there's no `import.meta.env.VITE_*` reference in any
source file. Nothing in the app is currently configurable per-environment —
everything is a compile-time constant baked into the bundle.

## 10. Dependencies

**Runtime:**
- `react`, `react-dom` — UI
- `react-router-dom` — client-side routing (HashRouter)
- `recharts` — Dashboard/Reports charts

**Dev:**
- `vite`, `@vitejs/plugin-react` — build/dev server
- `typescript` — type checking (`tsc -b` runs before every build)
- `oxlint` — linting
- `@types/node`, `@types/react`, `@types/react-dom` — type definitions

That's the entire dependency surface. No state-management library (Redux,
Zustand, etc.) — all state is React `Context` + `useState`. No HTTP client. No
UI component library (all styling is hand-written CSS in `src/index.css`, ~1080
lines, using CSS custom properties for theming).

## 11. Security risks

See **`security-risks.md`** for the full write-up. Headline items:
- Authentication accepts any credentials and never persists a real password.
- All "sensitive" data (auth state, financial records) sits in plaintext
  `localStorage`, readable by any script that runs in the page (XSS blast
  radius = everything).
- Plan/billing changes are pure client-side state mutation with no payment
  verification — anyone can "upgrade" by clicking a button, or by editing
  `localStorage` directly.
- No CSRF/session concerns *yet* only because there is no server session to
  attack — this changes the moment a backend is added.
- TypeScript **`strict` mode is not enabled** (`tsconfig.app.json` has no
  `"strict": true`), so null/undefined-related bugs are not caught at the type
  level as aggressively as they could be.

## 12. Deployment configuration

- **Host:** GitHub Pages, repo `a293moha/NeroBooks`, live at
  `https://a293moha.github.io/NeroBooks/`.
- **CI/CD:** `.github/workflows/deploy.yml` — on every push to `main`:
  1. Checkout, Node 20 setup (`actions/setup-node@v4`, npm cache).
  2. `npm ci && npm run build` (runs `tsc -b && vite build`).
  3. `actions/upload-pages-artifact@v3` uploads `dist/`.
  4. `actions/deploy-pages@v4` publishes it to Pages.
- Requires the repo's **Settings → Pages → Source** to be set to **"GitHub
  Actions"** (a manual one-time step; not automatable from the workflow file
  itself).
- `vite.config.ts` sets `base: '/NeroBooks/'` to match the Pages subpath —
  **this must be updated if the repo is ever renamed again**, or all asset URLs
  in production will 404.
- No staging environment, no preview deployments, no rollback mechanism beyond
  `git revert` + re-push. No environment separation of any kind (dev/prod are
  the same static bundle).

## 13. Which frontend screens are complete

**Visually and interactively complete** (fully navigable, forms work, state
persists via localStorage): Dashboard, Invoices (create + list + filter),
Customers (create + list), Expenses (create + list), Vendors (create + list),
Chart of Accounts (list), Transactions (list), Reports (all 5 tabs + CSV
export), Team (invite/remove + seat cap), Billing (plan switch + full feature
matrix), Sign in / Buy-now wizard (all 4 steps).

**Every screen is "complete" only in the sense of being a finished UI wired to
local mock state** — none of them talk to a server, and several (Accounts,
Transactions) are display-only with no way to add or edit a record through the
UI at all, despite what a real Chart of Accounts / ledger page would need.

## 14. Which buttons/forms currently do nothing

- **Header search bar** (`Layout.tsx`, all pages) — rendered with a
  placeholder ("Search invoices, customers, transactions…") but has **no
  `value`, `onChange`, or submit handler**. Typing into it does nothing at all;
  it doesn't even hold what you typed.
- **`DataContext.resetDemoData()`** — fully implemented (resets all seeded
  collections back to their original arrays) but **no button anywhere calls
  it**. Dead code.
- **`DataContext.updateInvoice()`** — fully implemented but **never called**;
  there is no "edit invoice" UI, so this exists for a feature that isn't built.
- Any feature shown in the Billing-page **feature comparison matrix** that
  isn't in the "real gating" list in `backend-roadmap.md` §"What's real vs.
  display-only" — e.g. clicking around "Inventory tracking," "Enter time,"
  "Contract upload and e-signature" doesn't lead anywhere, because those pages
  don't exist. The matrix is accurate about what plan *would* include them; it
  does not imply the feature is built.
- Password field on both Sign-in and Checkout forms — accepts input, shows the
  masked dots, but the value is discarded on submit (see §4).

## 15. Which backend services need to be created

Covered in detail in **`backend-roadmap.md`**. In one line: everything —
there is currently zero backend. At minimum: an auth service (real password
hashing + sessions/tokens), a data-persistence API for every entity in
`types.ts`, a billing/subscription service (ideally via a real payments
provider, not self-reported plan state), and a live currency-exchange-rate
feed to replace the static table.
