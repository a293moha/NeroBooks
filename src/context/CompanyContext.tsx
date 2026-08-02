import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { useApiClient } from "../lib/apiClient";
import type { PlanId } from "../lib/featureMatrix";

interface CompanySummary {
  id: string;
  name: string;
  trading_name: string | null;
  default_currency: string;
}

interface CompanyContextValue {
  companyId: string | null;
  companyName: string | null;
  isLoading: boolean;
  /** True once loaded and this user holds no active company membership at all. */
  needsOnboarding: boolean;
  completeOnboarding: (input: { companyName: string; plan: PlanId; defaultCurrency?: string }) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

/**
 * Resolves which company the signed-in user is acting within. This is a
 * UI convenience only — every API request is independently re-verified
 * server-side against the caller's real company_memberships row (see
 * requireCompanyAccess in server/src/auth/middleware.ts), so nothing here
 * is ever persisted to localStorage: there is no "change company by
 * editing browser storage" attack surface to have in the first place,
 * because the frontend's belief about the active company carries no
 * authority at all.
 */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const api = useApiClient();

  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.get<CompanySummary[]>("/api/me/companies");
      setCompanies(result);
    } finally {
      setIsLoading(false);
    }
    // api.get is stable across renders (useApiClient memoizes it via
    // useCallback), so this is safe to omit from deps without refetching
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) {
      load();
    } else {
      setCompanies(null);
    }
  }, [user, load]);

  const completeOnboarding: CompanyContextValue["completeOnboarding"] = async (input) => {
    await api.post("/api/me/onboarding", {
      companyName: input.companyName,
      plan: input.plan,
      defaultCurrency: input.defaultCurrency,
    });
    await load();
  };

  const active = companies?.[0] ?? null;
  // While signed in, "loading" covers both the in-flight request AND the
  // brief window before the very first fetch has started at all -- without
  // the `companies === null` check, needsOnboarding/companyId would
  // momentarily read as "no company" for one render before load() gets a
  // chance to run, which would flash the onboarding screen even for
  // returning users who already have a company.
  const stillResolving = Boolean(user) && (isLoading || companies === null);

  const value: CompanyContextValue = {
    companyId: active?.id ?? null,
    companyName: active?.trading_name ?? active?.name ?? null,
    isLoading: stillResolving,
    needsOnboarding: !stillResolving && companies !== null && companies.length === 0,
    completeOnboarding,
  };

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
