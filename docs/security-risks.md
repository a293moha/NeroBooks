# NeroBooks — Security Risk Assessment

Scope: the app **as it exists today** — a static, backend-less demo deployed
publicly on GitHub Pages — plus the risks that will appear the moment a real
backend, real users, and real payments are added per `backend-roadmap.md`.
Severity is rated for *today's demo context*; several items jump to
critical the instant this handles real customer data or money.

## Summary

| # | Risk | Severity today | Severity once backend/payments exist |
|---|---|---|---|
| 1 | Authentication accepts any credentials | Low (it's a labeled demo) | **Critical** if shipped as-is |
| 2 | No password is ever stored, hashed, or checked | Low | **Critical** |
| 3 | All app state lives in plaintext `localStorage` | Medium | High |
| 4 | Plan/billing is pure client-side state | Low | **Critical** |
| 5 | No input validation/sanitization beyond `.trim()` | Low | High |
| 6 | No route-level access control | Low | Medium |
| 7 | Team seat caps enforced only in the UI | Low | Medium |
| 8 | No password-reset or account-recovery flow | Low (there's no real account to recover) | High |
| 9 | Static, unauthenticated exchange rates presented as if current | Low | Medium (financial decisions on stale data) |
| 10 | TypeScript `strict` mode is off | Low | Low–Medium |
| 11 | No dependency-vulnerability scanning in CI | Low | Medium |
| 12 | GitHub Pages has no secret storage — future risk if misused | Low today (no secrets exist to leak) | High if a real API key ever gets committed |
| 13 | No CSP / security headers | Low | Medium |
| 14 | No rate limiting anywhere (no server to rate-limit yet) | N/A | High once an API exists |

---

## 1–2. Authentication is not real

`src/pages/SignIn.tsx` and `src/context/AuthContext.tsx`:

- Both the "Sign in" and "Create your account" forms collect a `password`
  value into component state, but **it is never read again after the
  `onChange` handler that sets it** — `submitSignIn`/`submitCheckout` only
  check `password.trim()` is non-empty, then call `signIn({name, email,
  plan})`. The password itself is discarded.
- There is no password hash, no server, no session token, no JWT — "being
  logged in" is `AuthContext.user !== null`, and that object is written
  straight to `localStorage["nerobooks-auth"]` as plain JSON.
- Anyone can become "logged in" as anyone by pasting a crafted object into
  `localStorage.setItem("nerobooks-auth", JSON.stringify({name: "...",
  email: "...", plan: "advanced"}))` in the browser console — no server
  round-trip exists to catch this.

**This is appropriate for a demo that says so out loud** ("This is a demo —
any email & password will work" is shown in the UI) **and becomes a critical
vulnerability the moment real user data or payments are attached to
accounts that behave this way.** Do not incrementally patch this — replace it
wholesale with a real auth provider or library per `backend-roadmap.md`
Phase 0. Hand-rolling password hashing/session management on top of the
current structure is not recommended; this is the highest-risk area to get
subtly wrong (timing attacks on comparison, weak hashing, session fixation,
etc.), which is exactly why the roadmap recommends a managed provider.

## 3. Plaintext data at rest in the browser

Every context (`AuthContext`, `DataContext`, `CurrencyContext`,
`TeamContext`) persists its entire state as unencrypted JSON in
`localStorage`. Concretely:

- `nerobooks-auth` — user's name, email, and plan.
- `nerobooks-data-v1` — every customer, vendor, invoice (with line items and
  amounts), expense, account, and ledger transaction the demo has ever
  created in that browser.
- `nerobooks-team` — invited team members' names and emails.

**Risk:** any script that runs in the page — including a successful XSS
injected through a future feature, or a malicious browser extension the user
has installed — has unrestricted read/write access to all of it, since
`localStorage` has no same-origin sub-scoping and no encryption. There is
currently no user-generated content rendered as raw HTML anywhere in the app
(React escapes by default, and nothing uses `dangerouslySetInnerHTML`), which
keeps today's XSS surface low — but that protection is about *injection*, not
about protecting data that's already sitting in `localStorage` if some other
script does get to run.

**Mitigation path:** once a real backend exists, none of this should live in
`localStorage` at all — financial records belong server-side, behind
authentication, not in browser storage. Session tokens (if using them instead
of cookies) should be as short-lived as practical and never store more than
the minimum needed to authenticate.

## 4. Billing state is self-reported

`AuthContext.setPlan()` lets any signed-in user set their own `plan` to
`"advanced"` with a single function call — there is no purchase, no payment
confirmation, nothing gating it beyond "click the button on `/billing`." The
entire feature-gating system in `src/lib/planLimits.ts` is real and correctly
enforced *in the UI*, but it is enforcing a value the user fully controls.

**This is fine for a demo showing what gating would look like.** It is not
acceptable the moment `plan` corresponds to actual billing — see
`backend-roadmap.md`'s repeated point: plan/subscription state must be
written only by a payment-provider webhook handler on the server, never by a
client request, no matter how the request is authenticated.

## 5. Input validation is minimal and entirely client-side

Documented fully in `current-architecture.md` §6; the security-relevant
summary:

- No email-format validation on Customers/Vendors forms (plain `type="text"`
  inputs).
- No length limits on any text field — a name, memo, or notes field could
  hold arbitrary-length input today with no consequence because it's just a
  local object; **the day this hits a database, unbounded text input is how
  you get storage abuse and, if ever concatenated into a raw SQL string
  instead of parameterized, SQL injection.**
- `type="number" min={0}` is a browser-level UI hint only — it does not
  prevent a negative or absurd value from reaching application state if the
  input event is dispatched programmatically or a future API is called
  directly instead of through this form.
- No server exists today to duplicate these checks, so no matter what the
  frontend does, **every one of these checks must be re-implemented
  server-side and treated as the authoritative check** — never trust a
  client-side check alone, including the ones already in this codebase.

## 6. No route-level access control

`App.tsx`'s `AuthGate` is all-or-nothing: logged out shows `<SignIn />` for
every URL, logged in shows every route for every user. There is no per-page
permission check (e.g., nothing stops a "Member"-role team invite, once real
roles exist, from reaching `/billing` and changing the subscription). Once
real roles/permissions matter, each route/action needs its own authorization
check, not just a single top-level "is anyone logged in" gate.

## 7. Team seat limits are a UI-only speed bump

`src/pages/Team.tsx` disables the "Invite member" button once `totalMembers
>= limits.maxTeamMembers`. This is enforced **only** by not rendering an
enabled button — `TeamContext.addInvitee()` itself has no limit check and can
be called directly (e.g. from the browser console, or once there's an API,
from a raw HTTP request) to exceed the cap. Any business-meaningful limit
(seats, invoice volume, storage) must be enforced server-side.

## 8. No account recovery

There is no "forgot password" flow, which is a availability/security-adjacent
gap: once real passwords exist, users **will** forget them, and without a
recovery flow the only options are "contact support to manually reset" (an
operational burden and its own social-engineering risk if not done
carefully) or account lockout. Build the reset-token flow (short-lived,
single-use, hashed token — see `database-requirements.md`'s
`password_reset_tokens` table) as part of Phase 0, not as an afterthought.

## 9. Exchange rates are static and unlabeled-as-such in most of the UI

`src/lib/exchangeRates.ts`'s own comment says these are "For demo/display
purposes only — not wired to a live rates feed," but that caveat isn't
surfaced anywhere in the actual product UI (Pricing cards, Invoices, Reports
all show converted amounts with no "rates as of [date], for estimation only"
disclosure). This isn't a classic security vulnerability, but it is a
real-money-decision risk once anyone relies on these numbers being current —
flag it before this goes near production, either by fetching live rates
(see `backend-roadmap.md`) or by adding a visible "rates are illustrative"
disclaimer everywhere they're shown.

## 10. TypeScript strict mode is disabled

`tsconfig.app.json` has no `"strict": true`. This doesn't cause a
vulnerability by itself, but it means categories of bugs that strict mode
catches at compile time (unchecked `null`/`undefined` access, implicit `any`,
unsafe type narrowing) are not caught here — some of those bugs do
historically turn into real vulnerabilities (null-check bypasses, type
confusion) once the codebase is handling untrusted input from a real API
instead of only its own hard-coded seed data. Recommend enabling `strict`
before or during the backend migration, while the codebase is still small
enough that the fallout is manageable.

## 11. No dependency vulnerability scanning

There's no `npm audit` step, Dependabot config, or Renovate config visible in
the repo. The dependency list is currently small (5 runtime packages) and
low-risk, but this should be added before the dependency surface grows with a
backend, an ORM, an auth library, and a payments SDK.

## 12. GitHub Pages and secrets

Today there are no secrets anywhere in this repo or its deployed bundle
(confirmed: no `.env` files, no `import.meta.env.VITE_*` usage). This is a
"currently fine, but a landmine for later" item: **GitHub Pages serves
whatever is in the built bundle to the entire internet with no access
control** — the moment an API key, even a "restricted" one, gets added via
`import.meta.env` for convenience, it ships in plaintext in the JS bundle.
Only genuinely public keys (e.g. a Stripe *publishable* key, never the secret
key) may ever go into this frontend. Everything else belongs on the API
server, which is not on GitHub Pages.

## 13. No Content-Security-Policy or security headers

GitHub Pages does not let you set custom HTTP response headers, so there is
currently no CSP, `X-Frame-Options`, `Referrer-Policy`, etc. This is a
consequence of the hosting choice, not something fixable in-app. If/when the
frontend moves behind a CDN or reverse proxy you control (common once there's
a real backend and possibly a custom domain), add these headers there.

## 14. No rate limiting (not yet applicable, but plan for it)

There is no server to rate-limit today. The moment there is one, budget for
rate limiting on at least: login attempts (brute-force protection),
password-reset requests (abuse/enumeration protection), and invite-sending
(spam protection) — none of this exists to forget about later; call it out
explicitly in the Phase 0/2 backend work.

---

## Prioritized remediation checklist (do these, in this order, before any real user data or payment touches this app)

1. Replace fake auth with a real provider/library (hashed passwords,
   sessions, email verification, password reset).
2. Move all persistent data server-side, behind that auth — stop writing
   financial records to `localStorage`.
3. Make `subscriptions.plan` writable only by a payment webhook handler,
   never by any client-authenticated request.
4. Re-implement every existing client-side validation check server-side as
   the authoritative version (email format, non-empty, numeric ranges,
   string length limits) — assume every request bypasses the frontend
   entirely.
5. Add per-organization data isolation (scoped queries + consider Postgres
   row-level security) before there are two organizations to leak between.
6. Enable TypeScript `strict` mode.
7. Add `npm audit`/Dependabot to CI.
8. Add a disclaimer wherever converted-currency amounts are shown, or switch
   to live rates, before anyone relies on them financially.
