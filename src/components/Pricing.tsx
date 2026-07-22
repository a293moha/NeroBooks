import { plans } from "../lib/plans";
import { convertFromUsd } from "../lib/exchangeRates";
import { currency } from "../lib/format";
import { flagEmoji, type Country } from "../lib/countries";
import type { PlanId } from "../lib/featureMatrix";
import FeatureMatrix from "./FeatureMatrix";

export default function Pricing({
  country,
  onChoosePlan,
}: {
  country: Country;
  onChoosePlan: (planId: PlanId) => void;
}) {
  return (
    <div>
      <div className="pricing-country-badge">
        {flagEmoji(country.code)} Pricing shown in {country.currency} for {country.name}
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => {
          const price = convertFromUsd(plan.priceUsd, country.currency);
          const strike = convertFromUsd(plan.strikeUsd, country.currency);
          return (
            <div key={plan.id} className={`pricing-card ${plan.highlight ? "highlight" : ""}`}>
              {plan.highlight && <div className="pricing-badge">Most popular</div>}
              <div className="pricing-name">{plan.name}</div>
              <div className="pricing-tagline">{plan.tagline}</div>
              <div className="pricing-price-row">
                <span className="pricing-strike">{currency(strike, country.currency)}</span>
                <span className="pricing-price">{currency(price, country.currency)}</span>
                <span className="pricing-period">/mo</span>
              </div>
              <button
                className={plan.highlight ? "btn-primary pricing-cta" : "btn-secondary pricing-cta"}
                onClick={() => onChoosePlan(plan.id)}
              >
                Get {plan.name}
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
      <FeatureMatrix />
    </div>
  );
}
