import type { Expense, Invoice } from "../types";

export interface MonthlyTrendPoint {
  month: string;
  income: number;
  expenses: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Real trailing-N-month income (paid invoices) / expenses, grouped by
 * calendar month and computed from this company's own real invoices and
 * expenses -- this used to be hardcoded seed data that showed the same
 * fake $17k month for every company regardless of whether they'd ever
 * created a single record. A brand-new company now correctly gets all
 * zeros here.
 */
export function computeMonthlyTrend(invoices: Invoice[], expenses: Expense[], monthCount = 6): MonthlyTrendPoint[] {
  const now = new Date();
  const points: MonthlyTrendPoint[] = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const income = invoices
      .filter((inv) => inv.status === "paid" && sameMonth(new Date(inv.issueDate), ref))
      .reduce((sum, inv) => sum + inv.total, 0);
    const expenseTotal = expenses
      .filter((e) => sameMonth(new Date(e.date), ref))
      .reduce((sum, e) => sum + e.amount, 0);
    points.push({ month: MONTH_LABELS[ref.getMonth()], income, expenses: expenseTotal });
  }
  return points;
}

/** Naive linear-growth projection off the trailing trend — illustrative, not a real forecasting model. */
export function projectNextMonths(trend: MonthlyTrendPoint[], count: number): MonthlyTrendPoint[] {
  const n = trend.length;
  const last = trend[n - 1];
  if (!last) return [];

  const avgIncomeGrowth =
    n > 1 ? trend.slice(1).reduce((sum, m, i) => sum + (m.income - trend[i].income), 0) / (n - 1) : 0;
  const avgExpenseGrowth =
    n > 1 ? trend.slice(1).reduce((sum, m, i) => sum + (m.expenses - trend[i].expenses), 0) / (n - 1) : 0;

  const now = new Date();
  const projection: MonthlyTrendPoint[] = [];
  for (let i = 0; i < count; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    projection.push({
      month: MONTH_LABELS[ref.getMonth()],
      income: Math.max(0, Math.round(last.income + avgIncomeGrowth * (i + 1))),
      expenses: Math.max(0, Math.round(last.expenses + avgExpenseGrowth * (i + 1))),
    });
  }
  return projection;
}
