export type PlanId = "starter" | "pro";

export interface PlanLimits {
  label: string;
  maxTeamMembers: number;
  multiCurrencyInvoicing: boolean;
  advancedReports: boolean;
  exportReports: boolean;
}

export const planLimits: Record<PlanId, PlanLimits> = {
  starter: {
    label: "Starter",
    maxTeamMembers: 3,
    multiCurrencyInvoicing: false,
    advancedReports: false,
    exportReports: false,
  },
  pro: {
    label: "Pro",
    maxTeamMembers: Infinity,
    multiCurrencyInvoicing: true,
    advancedReports: true,
    exportReports: true,
  },
};
