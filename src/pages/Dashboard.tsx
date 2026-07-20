import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { convertAmount } from "../lib/exchangeRates";
import { currency, invoiceTotal } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

const monthlyTrend = [
  { month: "Feb", income: 14200, expenses: 4800 },
  { month: "Mar", income: 15800, expenses: 5100 },
  { month: "Apr", income: 13950, expenses: 4650 },
  { month: "May", income: 17300, expenses: 5400 },
  { month: "Jun", income: 19800, expenses: 5800 },
  { month: "Jul", income: 22300, expenses: 5940 },
];

// Recharts sets these as raw SVG attributes, which cannot resolve CSS
// custom properties — literal hex is required here (mirrors index.css vars).
const BRAND_YELLOW_DARK = "#c99a00";
const SERIES_BLUE = "#2a78d6";

const categoryColors: Record<string, string> = {
  Software: "#2a78d6",
  Utilities: "#1baf7a",
  "Office Supplies": "#eda100",
  Travel: "#4a3aa7",
  Rent: "#e34948",
  Advertising: "#e87ba4",
  Payroll: "#eb6834",
  Insurance: "#008300",
  Other: "#8a8776",
};

export default function Dashboard() {
  const { invoices, customers, expenses } = useData();
  const { currencyCode, currencyOptions } = useCurrency();
  const symbol = currencyOptions.find((c) => c.code === currencyCode)?.symbol ?? "$";

  const inAccountCurrency = (inv: (typeof invoices)[number]) =>
    convertAmount(invoiceTotal(inv), inv.currency ?? currencyCode, currencyCode);

  const outstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((sum, i) => sum + inAccountCurrency(i), 0);

  const overdue = invoices
    .filter((i) => i.status === "overdue")
    .reduce((sum, i) => sum + inAccountCurrency(i), 0);

  const paidThisMonth = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + inAccountCurrency(i), 0);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const recentInvoices = invoices.slice(0, 5);
  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Here's how your business is doing.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="stat-tile-label">Outstanding invoices</div>
          <div className="stat-tile-value">{currency(outstanding, currencyCode)}</div>
          <div className="stat-tile-delta up">Across {invoices.filter((i) => i.status !== "paid" && i.status !== "draft").length} invoices</div>
        </div>
        <div className="card">
          <div className="stat-tile-label">Overdue</div>
          <div className="stat-tile-value">{currency(overdue, currencyCode)}</div>
          <div className="stat-tile-delta down">Needs follow-up</div>
        </div>
        <div className="card">
          <div className="stat-tile-label">Paid</div>
          <div className="stat-tile-value">{currency(paidThisMonth, currencyCode)}</div>
          <div className="stat-tile-delta up">This month</div>
        </div>
        <div className="card">
          <div className="stat-tile-label">Total expenses</div>
          <div className="stat-tile-value">{currency(totalExpenses, currencyCode)}</div>
          <div className="stat-tile-delta down">This month</div>
        </div>
      </div>

      <div className="chart-row">
        <div className="card">
          <h3 className="card-title">Income vs. expenses</h3>
          <p className="card-sub">Last 6 months</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyTrend} barGap={4}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                tickFormatter={(v) => `${symbol}${v / 1000}k`}
                width={44}
              />
              <Tooltip
                formatter={(value) => currency(Number(value), currencyCode)}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  fontSize: 13,
                }}
              />
              <Bar dataKey="income" name="Income" fill={BRAND_YELLOW_DARK} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expenses" name="Expenses" fill={SERIES_BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span><span className="legend-dot" style={{ background: "var(--brand-yellow-dark)" }} />Income</span>
            <span><span className="legend-dot" style={{ background: "var(--series-blue)" }} />Expenses</span>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Expenses by category</h3>
          <p className="card-sub">This month</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>
                {byCategory.map((entry) => (
                  <Cell key={entry.name} fill={categoryColors[entry.name] ?? "#8a8776"} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => currency(Number(value))} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend-row">
            {byCategory.map((c) => (
              <span key={c.name}>
                <span className="legend-dot" style={{ background: categoryColors[c.name] ?? "var(--text-muted)" }} />
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Due date</th>
              <th>Status</th>
              <th className="cell-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {recentInvoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.number}</td>
                <td className="cell-muted">{customerName(inv.customerId)}</td>
                <td className="cell-muted">{inv.dueDate}</td>
                <td>
                  <StatusBadge status={inv.status} />
                </td>
                <td className="cell-num">{currency(invoiceTotal(inv), inv.currency ?? currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
