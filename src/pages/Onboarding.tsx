import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useCurrency } from "../context/CurrencyContext";
import { plans } from "../lib/plans";
import type { PlanId } from "../lib/featureMatrix";
import { ApiError } from "../lib/apiClient";

/**
 * Shown once, right after a brand-new Auth0 identity's first sign-in, for
 * anyone who holds no active company membership yet (see
 * CompanyContext.needsOnboarding). The "Buy now" flow in SignIn.tsx never
 * collects a company name -- only country and plan, before handing off to
 * Auth0 -- so this is the first and only place that's actually asked for.
 * user.plan carries the plan chosen during that flow (a local preview
 * value until this submits, at which point it becomes a real
 * company_subscriptions row) as this form's starting selection.
 */
export default function Onboarding() {
  const { user } = useAuth();
  const { completeOnboarding } = useCompany();
  const { currencyCode } = useCurrency();

  const [companyName, setCompanyName] = useState("");
  const [planId, setPlanId] = useState<PlanId>(user?.plan ?? "easystart");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Please enter your company name.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await completeOnboarding({ companyName: companyName.trim(), plan: planId, defaultCurrency: currencyCode });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="brand-mark">NB</span>
          <span>NeroBooks</span>
        </div>

        <h1 className="signin-title">Set up your company</h1>
        <p className="signin-sub">One last step before your workspace is ready.</p>

        <form onSubmit={submit} className="signin-form">
          <div>
            <label>Company name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              autoComplete="off"
              autoFocus
            />
          </div>
          <div>
            <label>Plan</label>
            <select value={planId} onChange={(e) => setPlanId(e.target.value as PlanId)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="signin-error">{error}</div>}

          <button type="submit" className="btn-primary signin-submit" disabled={submitting}>
            {submitting ? "Setting up…" : "Create my workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}
