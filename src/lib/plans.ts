import type { PlanId } from "./featureMatrix";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceUsd: number;
  strikeUsd: number;
  features: string[];
  missing?: string[];
  highlight?: boolean;
}

export const plans: Plan[] = [
  {
    id: "easystart",
    name: "EasyStart",
    tagline: "For solo founders just getting going",
    priceUsd: 3,
    strikeUsd: 30,
    features: [
      "1 user",
      "Automated bookkeeping & bank feeds",
      "Invoices, estimates & sales tax",
      "Receipt capture & mileage tracking",
      "Standard reports",
    ],
    missing: ["Multiple currencies", "Recurring invoices", "Inventory & project tools"],
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "For growing teams that bill and manage projects",
    priceUsd: 11,
    strikeUsd: 110,
    highlight: true,
    features: [
      "Up to 5 users",
      "Everything in EasyStart",
      "Multiple currencies & recurring invoices",
      "Inventory, purchase & sales orders",
      "Project management & time tracking",
      "Budgeting & enhanced reports",
    ],
    missing: ["Forecasting", "Custom report builder", "Workflow automation"],
  },
  {
    id: "advanced",
    name: "Advanced",
    tagline: "Built for scale",
    priceUsd: 22,
    strikeUsd: 220,
    features: [
      "Up to 25 users",
      "Everything in Plus",
      "Forecasting & custom report builder",
      "Data sync with Excel",
      "Workflow automation & batch invoicing",
      "Custom roles, permissions & backup/restore",
    ],
  },
];
