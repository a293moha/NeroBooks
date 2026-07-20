export interface Plan {
  id: "starter" | "pro";
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
    id: "starter",
    name: "Starter",
    tagline: "For freelancers and small teams",
    priceUsd: 15,
    strikeUsd: 25,
    features: [
      "Up to 3 team members",
      "Unlimited invoices & expenses",
      "Core reports (P&L, Balance Sheet)",
      "1 connected currency",
      "Standard email support",
    ],
    missing: ["Multi-currency invoicing", "Priority support"],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing businesses",
    priceUsd: 35,
    strikeUsd: 60,
    highlight: true,
    features: [
      "Unlimited team members",
      "Everything in Starter",
      "Multi-currency invoicing",
      "Advanced reports & exports",
      "Priority support",
      "Early access to new features",
    ],
  },
];
