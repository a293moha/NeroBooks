import { useState } from "react";
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
  const { signIn } = useAuth();
  const { setCurrencyCode } = useCurrency();
  const [step, setStep] = useState<Step>("signin");

  const [country, setCountry] = useState<Country | null>(null);
  const [planId, setPlanId] = useState<PlanId | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submitSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    signIn({ name: email.split("@")[0], email: email.trim(), plan: "easystart" });
  };

  const submitCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    if (country) setCurrencyCode(country.currency);
    signIn({ name: name.trim(), email: email.trim(), plan: planId ?? "easystart" });
  };

  const plan = plans.find((p) => p.id === planId);

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
            <p className="signin-sub">Welcome back — enter your details to continue.</p>

            <form onSubmit={submitSignIn} className="signin-form">
              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {error && <div className="signin-error">{error}</div>}

              <button type="submit" className="btn-primary signin-submit">
                Sign in
              </button>
            </form>

            <button
              type="button"
              className="btn-secondary signin-submit signin-register"
              onClick={() => {
                setError("");
                setStep("country");
              }}
            >
              Buy now
            </button>

            <p className="signin-note">This is a demo — any email &amp; password will work.</p>
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

            <form onSubmit={submitCheckout} className="signin-form">
              <div>
                <label>Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" />
              </div>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>

              {error && <div className="signin-error">{error}</div>}

              <button type="submit" className="btn-primary signin-submit">
                Start {plan.name} plan
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
