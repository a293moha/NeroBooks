import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useAuth } from "../context/AuthContext";
import { useCurrency } from "../context/CurrencyContext";
import CountryPicker from "../components/CountryPicker";
import Pricing from "../components/Pricing";
import { plans } from "../lib/plans";
import { convertFromUsd } from "../lib/exchangeRates";
import { currency } from "../lib/format";
import { flagEmoji, type Country } from "../lib/countries";
import type { PlanId } from "../lib/featureMatrix";

type Step = "signin" | "country" | "pricing" | "checkout";

export default function SignIn() {
  const { loginWithRedirect } = useAuth0();
  const { setPlan } = useAuth();
  const { setCurrencyCode } = useCurrency();
  const [step, setStep] = useState<Step>("signin");

  const [country, setCountry] = useState<Country | null>(null);
  const [planId, setPlanId] = useState<PlanId | null>(null);

  const plan = plans.find((p) => p.id === planId);

  // The chosen plan/currency are applied locally (they're preview-only
  // preferences, not identity) before handing off to Auth0's own hosted
  // signup page — real account creation, including the password itself,
  // happens there, never in this app's own form.
  const startCheckout = () => {
    if (country) setCurrencyCode(country.currency);
    if (planId) setPlan(planId);
    loginWithRedirect({ authorizationParams: { screen_hint: "signup" } });
  };

  return (
    <div className="signin-page">
      <div className={`signin-card ${step === "pricing" ? "signin-card-wide" : ""}`}>
        <div className="signin-brand">
          <span className="brand-mark">NB</span>
          <span>NeroBooks</span>
        </div>

        {step === "signin" && (
          <>
            <h1 className="signin-title">Sign in to your account</h1>
            <p className="signin-sub">Welcome back — sign in to continue.</p>

            <button type="button" className="btn-primary signin-submit" onClick={() => loginWithRedirect()}>
              Sign in
            </button>

            <button
              type="button"
              className="btn-secondary signin-submit signin-register"
              onClick={() => setStep("country")}
            >
              Buy now
            </button>
          </>
        )}

        {step === "country" && (
          <>
            <button type="button" className="signin-back" onClick={() => setStep("signin")}>
              ← Back
            </button>
            <h1 className="signin-title">Pick your country</h1>
            <p className="signin-sub">We'll show pricing in your local currency.</p>
            <CountryPicker
              onSelect={(c) => {
                setCountry(c);
                setStep("pricing");
              }}
            />
          </>
        )}

        {step === "pricing" && country && (
          <>
            <button type="button" className="signin-back" onClick={() => setStep("country")}>
              ← Back
            </button>
            <h1 className="signin-title">Choose your plan</h1>
            <p className="signin-sub">Cancel anytime.</p>
            <Pricing
              country={country}
              onChoosePlan={(id) => {
                setPlanId(id);
                setStep("checkout");
              }}
            />
          </>
        )}

        {step === "checkout" && country && plan && (
          <>
            <button type="button" className="signin-back" onClick={() => setStep("pricing")}>
              ← Back
            </button>
            <h1 className="signin-title">Create your account</h1>
            <p className="signin-sub">
              {flagEmoji(country.code)} {plan.name} plan — {currency(convertFromUsd(plan.priceUsd, country.currency), country.currency)}/mo
            </p>
            <p className="signin-sub">You'll create your login on the next screen.</p>

            <button type="button" className="btn-primary signin-submit" onClick={startCheckout}>
              Continue to create your account
            </button>
          </>
        )}
      </div>
    </div>
  );
}
