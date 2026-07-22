export const monthlyTrend = [
  { month: "Feb", income: 14200, expenses: 4800 },
  { month: "Mar", income: 15800, expenses: 5100 },
  { month: "Apr", income: 13950, expenses: 4650 },
  { month: "May", income: 17300, expenses: 5400 },
  { month: "Jun", income: 19800, expenses: 5800 },
  { month: "Jul", income: 22300, expenses: 5940 },
];

/** Naive linear-growth projection off the trailing trend — illustrative, not a real forecasting model. */
export function projectNextMonths(count: number) {
  const n = monthlyTrend.length;
  const avgIncomeGrowth =
    monthlyTrend.slice(1).reduce((sum, m, i) => sum + (m.income - monthlyTrend[i].income), 0) / (n - 1);
  const avgExpenseGrowth =
    monthlyTrend.slice(1).reduce((sum, m, i) => sum + (m.expenses - monthlyTrend[i].expenses), 0) / (n - 1);

  const last = monthlyTrend[n - 1];
  const months = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"];
  const projection = [];
  for (let i = 0; i < count; i++) {
    projection.push({
      month: months[i] ?? `+${i + 1}`,
      income: Math.max(0, Math.round(last.income + avgIncomeGrowth * (i + 1))),
      expenses: Math.max(0, Math.round(last.expenses + avgExpenseGrowth * (i + 1))),
    });
  }
  return projection;
}
