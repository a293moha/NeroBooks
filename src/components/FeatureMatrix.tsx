import { useState } from "react";
import { featureCategories, type FeatureValue, type PlanId } from "../lib/featureMatrix";
import { plans } from "../lib/plans";

function Cell({ value }: { value: FeatureValue }) {
  if (value === true) return <span className="fm-check">✓</span>;
  if (value === false) return <span className="fm-dash">–</span>;
  return <span className="fm-value">{value}</span>;
}

export default function FeatureMatrix({ currentPlan }: { currentPlan?: PlanId }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="feature-matrix">
      <div className="fm-header-row">
        <div className="fm-header-label">All features</div>
        {plans.map((p) => (
          <div key={p.id} className={`fm-header-plan ${p.id === currentPlan ? "fm-current" : ""}`}>
            {p.name}
          </div>
        ))}
      </div>

      {featureCategories.map((category) => {
        const isCollapsed = collapsed[category.name];
        return (
          <div className="fm-category" key={category.name}>
            <div
              className="fm-category-header"
              onClick={() => setCollapsed((prev) => ({ ...prev, [category.name]: !prev[category.name] }))}
            >
              <span>{category.name}</span>
              <span className={`fm-chevron ${isCollapsed ? "collapsed" : ""}`}>▾</span>
            </div>
            {!isCollapsed && (
              <div className="fm-rows">
                {category.features.map((feature) => (
                  <div className="fm-row" key={feature.name}>
                    <div className="fm-feature-name">
                      {feature.name}
                      {feature.beta && <span className="fm-beta">BETA</span>}
                    </div>
                    {plans.map((p) => (
                      <div key={p.id} className={`fm-cell ${p.id === currentPlan ? "fm-current" : ""}`}>
                        <Cell value={feature.values[p.id]} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
