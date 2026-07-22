import { featureCategories, type PlanId } from "./featureMatrix";

export type { PlanId };

function featureValue(name: string, plan: PlanId) {
  for (const category of featureCategories) {
    const feature = category.features.find((f) => f.name === name);
    if (feature) return feature.values[plan];
  }
  throw new Error(`Unknown feature: ${name}`);
}

export interface PlanLimits {
  label: string;
  maxTeamMembers: number;
  multiCurrencyInvoicing: boolean;
  recurringInvoices: boolean;
  cashFlowPlanning: boolean;
  budgeting: boolean;
  forecasting: boolean;
  exportReports: boolean;
  reportsLevel: string;
}

const planLabels: Record<PlanId, string> = {
  easystart: "EasyStart",
  plus: "Plus",
  advanced: "Advanced",
};

const planIds: PlanId[] = ["easystart", "plus", "advanced"];

export const planLimits: Record<PlanId, PlanLimits> = planIds.reduce((acc, id) => {
  acc[id] = {
    label: planLabels[id],
    maxTeamMembers: featureValue("Users", id) as number,
    multiCurrencyInvoicing: featureValue("Multiple currencies", id) as boolean,
    recurringInvoices: featureValue("Recurring invoices", id) as boolean,
    cashFlowPlanning: featureValue("Cash flow planning", id) as boolean,
    budgeting: featureValue("Budgeting", id) as boolean,
    forecasting: featureValue("Forecasting", id) as boolean,
    exportReports: featureValue("Data sync with Excel", id) as boolean,
    reportsLevel: featureValue("Reports", id) as string,
  };
  return acc;
}, {} as Record<PlanId, PlanLimits>);
