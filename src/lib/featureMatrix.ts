export type PlanId = "easystart" | "plus" | "advanced";

export type FeatureValue = boolean | string | number;

export interface FeatureRow {
  name: string;
  values: Record<PlanId, FeatureValue>;
  beta?: boolean;
}

export interface FeatureCategory {
  name: string;
  features: FeatureRow[];
}

const YES = true;
const NO = false;

// Transcribed exactly from the plan comparison matrix, category by category,
// left-to-right as EasyStart -> Plus -> Advanced (ascending price).
export const featureCategories: FeatureCategory[] = [
  {
    name: "Accounting",
    features: [
      { name: "Automated bookkeeping", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Tax deductions", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Automated bank feeds", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Smart expense categorization", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Multiple currencies", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Anomaly detection and resolution", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Revenue recognition", values: { easystart: NO, plus: NO, advanced: YES } },
      { name: "Auto-track fixed assets", values: { easystart: NO, plus: NO, advanced: YES } },
    ],
  },
  {
    name: "Expenses",
    features: [
      { name: "Auto-match transactions", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Receipt capture", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Mileage tracking", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Bill management", values: { easystart: NO, plus: YES, advanced: YES } },
    ],
  },
  {
    name: "Sales and Get Paid",
    features: [
      { name: "Estimates", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Invoice and payments", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Sales and sales tax", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Recurring invoices", values: { easystart: NO, plus: YES, advanced: YES } },
    ],
  },
  {
    name: "Customer Hub",
    features: [
      { name: "Customer management", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Notes and tasks management", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Reputation management", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Lead management", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Contract upload and e-signature", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Proposals", beta: true, values: { easystart: NO, plus: YES, advanced: YES } },
    ],
  },
  {
    name: "Time",
    features: [{ name: "Enter time", values: { easystart: NO, plus: YES, advanced: YES } }],
  },
  {
    name: "Project Management",
    features: [
      { name: "Project profitability", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Project management", values: { easystart: NO, plus: YES, advanced: YES } },
    ],
  },
  {
    name: "Inventory",
    features: [
      { name: "Inventory tracking", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Purchase orders", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Sales orders", values: { easystart: NO, plus: YES, advanced: YES } },
    ],
  },
  {
    name: "Business Intelligence",
    features: [
      { name: "Cash flow planning", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Budgeting", values: { easystart: NO, plus: YES, advanced: YES } },
      { name: "Forecasting", values: { easystart: NO, plus: NO, advanced: YES } },
      { name: "Custom report builder", values: { easystart: NO, plus: NO, advanced: YES } },
      { name: "Data sync with Excel", values: { easystart: NO, plus: NO, advanced: YES } },
    ],
  },
  {
    name: "Connected Platform",
    features: [
      { name: "Users", values: { easystart: 1, plus: 5, advanced: 25 } },
      { name: "Mobile app", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Automatic business feed", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Integrate with hundreds of apps", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Autosave & Data Protection", values: { easystart: YES, plus: YES, advanced: YES } },
      { name: "Reports", values: { easystart: "Standard", plus: "Enhanced", advanced: "Comprehensive" } },
      { name: "Custom roles and permissions", values: { easystart: NO, plus: "Basic", advanced: "Custom" } },
      { name: "Custom fields", values: { easystart: NO, plus: 4, advanced: 12 } },
      { name: "Class and location tracking", values: { easystart: NO, plus: "Up to 40", advanced: "Unlimited" } },
      { name: "Workflow automation", values: { easystart: NO, plus: NO, advanced: YES } },
      { name: "Batch invoices and expenses", values: { easystart: NO, plus: NO, advanced: YES } },
      { name: "Backup and restore", values: { easystart: NO, plus: NO, advanced: YES } },
    ],
  },
];

/** Features this build actually wires into real app behavior (not just displayed). */
export const enforcedFeatures = [
  "Multiple currencies",
  "Users",
  "Recurring invoices",
  "Cash flow planning",
  "Budgeting",
  "Forecasting",
  "Data sync with Excel",
  "Reports",
] as const;
