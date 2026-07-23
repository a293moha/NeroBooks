import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import type { PlanId } from "../lib/planLimits";

// Billing/subscription state is not real yet (no Stripe integration -- see
// docs/backend-roadmap.md Phase 2), so which plan a signed-in account is
// "on" is still a local preview toggle, kept deliberately separate from
// real identity below. It's a UI preview of gated features, not a claim
// about anyone's actual financial/customer data.
const PLAN_STORAGE_KEY = "nerobooks-plan-preview";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  isPlatformAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => void;
  setPlan: (plan: PlanId) => void;
  getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Legacy plan ids from the earlier 2-tier Starter/Pro structure.
const legacyPlanMap: Record<string, PlanId> = { starter: "easystart", pro: "advanced" };

function loadPlanPreview(): PlanId {
  const raw = localStorage.getItem(PLAN_STORAGE_KEY);
  if (!raw) return "easystart";
  return legacyPlanMap[raw] ?? (raw as PlanId);
}

interface BackendProfile {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    isAuthenticated,
    isLoading: auth0Loading,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  const [profile, setProfile] = useState<BackendProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [plan, setPlanState] = useState<PlanId>(loadPlanPreview);

  useEffect(() => {
    localStorage.setItem(PLAN_STORAGE_KEY, plan);
  }, [plan]);

  // Real identity now comes from Auth0 (who you are) plus our own backend
  // (what our database knows about you) — never from anything set locally.
  // This is the replacement for the old fake AuthContext, which used to
  // accept any email/password and store the whole "user" as plaintext
  // localStorage. See docs/multi-tenant-security.md for how the backend
  // verifies the access token this fetches with.
  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);

    (async () => {
      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
        const data = (await res.json()) as BackendProfile;
        if (!cancelled) setProfile(data);
      } catch (err) {
        console.error("Failed to load NeroBooks profile", err);
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, getAccessTokenSilently]);

  const user: AuthUser | null = profile
    ? { id: profile.id, name: profile.fullName, email: profile.email, plan, isPlatformAdmin: profile.isPlatformAdmin }
    : null;

  const value: AuthContextValue = {
    user,
    isLoading: auth0Loading || (isAuthenticated && profileLoading && !profile),
    signOut: () =>
      auth0Logout({ logoutParams: { returnTo: `${window.location.origin}${import.meta.env.BASE_URL}` } }),
    setPlan: (nextPlan) => setPlanState(nextPlan),
    getAccessToken: () => getAccessTokenSilently(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
