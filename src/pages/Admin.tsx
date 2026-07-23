import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { plans } from "../lib/plans";
import type { PlanId } from "../lib/featureMatrix";

interface PlatformCompany {
  id: string;
  name: string;
  trading_name: string | null;
  status: string;
  created_at: string;
}

/**
 * Platform-admin only: register a brand-new customer by email and set
 * which pricing tier they're on -- for onboarding done outside self-serve
 * checkout (invoiced, sales-assisted, etc.), which is the only way a
 * plan tier becomes a real fact today (see db/migrations/0020 and
 * server/src/routes/platform.routes.ts). The customer never hands us a
 * password here; they set their own via the link this returns.
 */
export default function Admin() {
  const { getAccessToken } = useAuth();
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [planId, setPlanId] = useState<PlanId>("easystart");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ email: string; passwordSetupUrl: string | null } | null>(null);

  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);

  const loadCompanies = async () => {
    setCompaniesLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/platform/companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCompanies(await res.json());
    } finally {
      setCompaniesLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !companyName.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    setSubmitting(true);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/platform/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: email.trim(), companyName: companyName.trim(), plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setResult({ email: data.email, passwordSetupUrl: data.passwordSetupUrl });
      setEmail("");
      setCompanyName("");
      loadCompanies();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform administration</h1>
          <p className="page-subtitle">Register new customers and see every company on the platform.</p>
        </div>
      </div>

      <div className="table-card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Register a new customer</h2>
        <form onSubmit={submit} className="signin-form" style={{ maxWidth: 420 }}>
          <div>
            <label>Customer email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@customer.com"
              autoComplete="off"
            />
          </div>
          <div>
            <label>Company name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              autoComplete="off"
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
            {submitting ? "Registering…" : "Register customer"}
          </button>
        </form>

        {result && (
          <div style={{ marginTop: 16, padding: 12, background: "var(--page-bg)", borderRadius: 8 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Customer registered: {result.email}</p>
            {result.passwordSetupUrl ? (
              <>
                <p style={{ margin: "0 0 6px" }}>Send them this link to set their password:</p>
                <code style={{ wordBreak: "break-all" }}>{result.passwordSetupUrl}</code>
              </>
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)" }}>
                Customer and company were created, but the password-setup link failed to generate. Try again from
                the Auth0 dashboard directly for now.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Status</th>
              <th>Registered</th>
            </tr>
          </thead>
          <tbody>
            {companiesLoading ? (
              <tr>
                <td colSpan={3} className="cell-muted">
                  Loading…
                </td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td colSpan={3} className="cell-muted">
                  No companies yet.
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.trading_name || c.name}</td>
                  <td className="cell-muted">{c.status}</td>
                  <td className="cell-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
