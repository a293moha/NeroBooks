import { useAuth } from "../context/AuthContext";
import { useCurrency } from "../context/CurrencyContext";
import { plans } from "../lib/plans";
import { convertFromUsd } from "../lib/exchangeRates";
import { currency } from "../lib/format";
import type { PlanId } from "../lib/featureMatrix";
import FeatureMatrix from "../components/FeatureMatrix";

export default function Billing() {
  const { user, setPlan } = useAuth();
  const { currencyCode } = useCurrency();

  if (!user) return null;

  const choosePlan = (id: PlanId) => setPlan(id);
  const currentIndex = plans.findIndex((p) => p.id === user.plan);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Manage your NeroBooks subscription</p>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map((plan, i) => {
          const price = convertFromUsd(plan.priceUsd, currencyCode);
          const isCurrent = user.plan === plan.id;
          const isUpgrade = i > currentIndex;
          return (
            <div key={plan.id} className={`pricing-card ${plan.highlight ? "highlight" : ""}`}>
              {isCurrent && <div className="pricing-badge pricing-badge-current">Current plan</div>}
              <div className="pricing-name">{plan.name}</div>
              <div className="pricing-tagline">{plan.tagline}</div>
              <div className="pricing-price-row">
                <span className="pricing-price">{currency(price, currencyCode)}</span>
                <span className="pricing-period">/mo</span>
              </div>
              <button
                className={isCurrent ? "btn-secondary pricing-cta" : "btn-primary pricing-cta"}
                disabled={isCurrent}
                onClick={() => choosePlan(plan.id)}
              >
                {isCurrent ? "Current plan" : isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
              </button>
              <ul className="pricing-features">
                {plan.features.map((f) => (
                  <li key={f} className="pricing-feature-yes">
                    {f}
                  </li>
                ))}
                {plan.missing?.map((f) => (
                  <li key={f} className="pricing-feature-no">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <h3 className="card-title" style={{ marginTop: 28, marginBottom: 12 }}>
        Compare every feature
      </h3>
      <FeatureMatrix currentPlan={user.plan} />
    </div>
  );
}
