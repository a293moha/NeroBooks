import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TeamMember } from "../types";

const STORAGE_KEY = "nerabooks-team";

interface TeamContextValue {
  invitees: TeamMember[];
  addInvitee: (member: Omit<TeamMember, "id">) => void;
  removeInvitee: (id: string) => void;
}

const TeamContext = createContext<TeamContextValue | null>(null);

function loadInitial(): TeamMember[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TeamMember[];
  } catch {
    return [];
  }
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const [invitees, setInvitees] = useState<TeamMember[]>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(invitees));
  }, [invitees]);

  const addInvitee = (member: Omit<TeamMember, "id">) =>
    setInvitees((prev) => [...prev, { ...member, id: `tm${Date.now()}` }]);

  const removeInvitee = (id: string) => setInvitees((prev) => prev.filter((m) => m.id !== id));

  return <TeamContext.Provider value={{ invitees, addInvitee, removeInvitee }}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
