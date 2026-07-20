import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PlanId } from "../lib/planLimits";

const STORAGE_KEY = "nerabooks-auth";

export interface AuthUser {
  name: string;
  email: string;
  plan: PlanId;
}

interface AuthContextValue {
  user: AuthUser | null;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
  setPlan: (plan: PlanId) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadInitial(): AuthUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    return { ...parsed, plan: parsed.plan ?? "starter" };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadInitial);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  const signIn = (nextUser: AuthUser) => setUser(nextUser);
  const signOut = () => setUser(null);
  const setPlan = (plan: PlanId) => setUser((prev) => (prev ? { ...prev, plan } : prev));

  return <AuthContext.Provider value={{ user, signIn, signOut, setPlan }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
