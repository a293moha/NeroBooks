import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function SignIn() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || (mode === "signup" && !name.trim())) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    const displayName = mode === "signup" ? name.trim() : email.split("@")[0];
    signIn({ name: displayName, email: email.trim() });
  };

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="brand-mark">NB</span>
          <span>NeraBooks</span>
        </div>
        <h1 className="signin-title">{mode === "signin" ? "Sign in to your account" : "Create your account"}</h1>
        <p className="signin-sub">
          {mode === "signin" ? "Welcome back — enter your details to continue." : "Set up NeraBooks in a few seconds."}
        </p>

        <form onSubmit={submit} className="signin-form">
          {mode === "signup" && (
            <div>
              <label>Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" />
            </div>
          )}
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
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          className="btn-secondary signin-submit signin-register"
          onClick={() => {
            setError("");
            setMode(mode === "signin" ? "signup" : "signin");
          }}
        >
          {mode === "signin" ? "Register" : "Back to sign in"}
        </button>

        <p className="signin-note">This is a demo — any email &amp; password will work.</p>
      </div>
    </div>
  );
}
