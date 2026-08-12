import { useState } from "react";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { useAuth } from "../context/AuthContext";
import { planLimits } from "../lib/planLimits";
import { computeMonthlyTrend, projectNextMonths } from "../lib/trend";
import { currency } from "../lib/format";
import UpgradeBanner from "../components/UpgradeBanner";

type Tab = "pl" | "bs" | "cf" | "budget" | "forecast";

// Illustrative monthly budgets per expense category — not user-editable in this build.
const monthlyBudgets: Record<string, number> = {
  Software: 150,
  Utilities: 220,
  Travel: 100,
  "Office Supplies": 120,
  Rent: 0,
  Advertising: 300,
  Payroll: 0,
  Insurance: 100,
  Other: 80,
};

export default function Reports() {
  const { accounts, expenses, invoices } = useData();
  const { currencyCode } = useCurrency();
  const { user } = useAuth();
  const fmt = (amount: number) => currency(amount, currencyCode);
  const [tab, setTab] = useState<Tab>("pl");

  if (!user) return null;
  const limits = planLimits[user.plan];

  const income = accounts.filter((a) => a.type === "income");
  const expenseAccounts = accounts.filter((a) => a.type === "expense");
  const totalIncome = income.reduce((sum, a) => sum + a.balance, 0);
  const totalExpenseAccount = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
  const netIncome = totalIncome - totalExpenseAccount;

  const expenseByCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {})
  );

  const assets = accounts.filter((a) => a.type === "asset");
  const liabilities = accounts.filter((a) => a.type === "liability");
  const equity = accounts.filter((a) => a.type === "equity");
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);

  // Cash accounts are the ones actually linked to a real bank account
  // (bank_accounts.chart_of_account_id), not guessed from a hardcoded
  // account code -- that link is the only reliable signal once the chart
  // of accounts is user-editable. Reads as $0 (with a note below) until a
  // bank account is linked, rather than silently guessing wrong.
  const cashAccounts = accounts.filter((a) => a.isCashAccount);
  const endingCash = cashAccounts.reduce((sum, a) => sum + a.balance, 0);
  const netChangeInCash = netIncome;
  const beginningCash = endingCash - netChangeInCash;

  const forecast = projectNextMonths(computeMonthlyTrend(invoices, expenses), 3);

  const exportCsv = () => {
    if (!limits.exportReports) return;
    let rows: string[][] = [];
    if (tab === "pl") {
      rows = [
        ["Profit & Loss"],
        ["Income"],
        ...income.map((a) => [a.name, a.balance.toFixed(2)]),
        ["Total income", totalIncome.toFixed(2)],
        ["Expenses"],
        ...expenseByCategory.map(([name, value]) => [name, value.toFixed(2)]),
        ["Total expenses", totalExpenseAccount.toFixed(2)],
        ["Net income", netIncome.toFixed(2)],
      ];
    } else if (tab === "bs") {
      rows = [
        ["Balance Sheet"],
        ["Assets"],
        ...assets.map((a) => [a.name, a.balance.toFixed(2)]),
        ["Total assets", totalAssets.toFixed(2)],
        ["Liabilities"],
        ...liabilities.map((a) => [a.name, a.balance.toFixed(2)]),
        ["Total liabilities", totalLiabilities.toFixed(2)],
        ["Equity"],
        ...equity.map((a) => [a.name, a.balance.toFixed(2)]),
        ["Total equity", totalEquity.toFixed(2)],
      ];
    } else if (tab === "cf") {
      rows = [
        ["Cash Flow Statement"],
        ["Operating activities", netIncome.toFixed(2)],
        ["Investing activities", "0.00"],
        ["Financing activities", "0.00"],
        ["Net change in cash", netChangeInCash.toFixed(2)],
        ["Beginning cash", beginningCash.toFixed(2)],
        ["Ending cash", endingCash.toFixed(2)],
      ];
    } else if (tab === "budget") {
      rows = [
        ["Budget vs Actual"],
        ["Category", "Budget", "Actual"],
        ...expenseByCategory.map(([name, value]) => [name, (monthlyBudgets[name] ?? 0).toFixed(2), value.toFixed(2)]),
      ];
    } else {
      rows = [["Forecast (next 3 months)"], ["Month", "Income", "Expenses"], ...forecast.map((f) => [f.month, String(f.income), String(f.expenses)])];
    }
    const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nerobooks-${tab}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: Tab; label: string; locked: boolean }[] = [
    { key: "pl", label: "Profit & Loss", locked: false },
    { key: "bs", label: "Balance Sheet", locked: false },
    { key: "cf", label: "Cash Flow", locked: !limits.cashFlowPlanning },
    { key: "budget", label: "Budgeting", locked: !limits.budgeting },
    { key: "forecast", label: "Forecast", locked: !limits.forecasting },
  ];

  const activeTab = tabs.find((t) => t.key === tab);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">
            Year to date · {limits.reportsLevel} reports on the {limits.label} plan
          </p>
        </div>
        <button className="btn-secondary" onClick={exportCsv} disabled={!limits.exportReports}>
          {limits.exportReports ? "Export CSV" : "🔒 Data sync with Excel"}
        </button>
      </div>

      <div className="tab-row">
        {tabs.map((t) => (
          <div key={t.key} className={`tab-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} {t.locked && "🔒"}
          </div>
        ))}
      </div>

      {activeTab?.locked ? (
        <UpgradeBanner
          message={`${activeTab.label} is available on the ${
            tab === "forecast" ? "Advanced" : "Plus"
          } plan and above.`}
        />
      ) : (
        <>
          {!limits.exportReports && (
            <UpgradeBanner message="Exporting reports for Excel is an Advanced-plan feature." />
          )}

          {tab === "pl" && (
            <div className="report-section">
              <h3 className="card-title">Income</h3>
              {income.map((a) => (
                <div className="report-line" key={a.id}>
                  <span>{a.name}</span>
                  <span>{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="report-line total">
                <span>Total income</span>
                <span>{fmt(totalIncome)}</span>
              </div>

              <h3 className="card-title" style={{ marginTop: 24 }}>
                Expenses
              </h3>
              {expenseByCategory.map(([name, value]) => (
                <div className="report-line sub" key={name}>
                  <span>{name}</span>
                  <span>{fmt(value)}</span>
                </div>
              ))}
              <div className="report-line total">
                <span>Total expenses</span>
                <span>{fmt(totalExpenseAccount)}</span>
              </div>

              <div className="report-line total" style={{ marginTop: 12, fontSize: 16 }}>
                <span>Net income</span>
                <span style={{ color: netIncome >= 0 ? "var(--status-good)" : "var(--status-critical)" }}>
                  {fmt(netIncome)}
                </span>
              </div>
            </div>
          )}

          {tab === "bs" && (
            <div className="report-section">
              <h3 className="card-title">Assets</h3>
              {assets.map((a) => (
                <div className="report-line" key={a.id}>
                  <span>{a.name}</span>
                  <span>{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="report-line total">
                <span>Total assets</span>
                <span>{fmt(totalAssets)}</span>
              </div>

              <h3 className="card-title" style={{ marginTop: 24 }}>
                Liabilities
              </h3>
              {liabilities.map((a) => (
                <div className="report-line" key={a.id}>
                  <span>{a.name}</span>
                  <span>{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="report-line total">
                <span>Total liabilities</span>
                <span>{fmt(totalLiabilities)}</span>
              </div>

              <h3 className="card-title" style={{ marginTop: 24 }}>
                Equity
              </h3>
              {equity.map((a) => (
                <div className="report-line" key={a.id}>
                  <span>{a.name}</span>
                  <span>{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="report-line total">
                <span>Total equity</span>
                <span>{fmt(totalEquity)}</span>
              </div>

              <div className="report-line total" style={{ marginTop: 12, fontSize: 16 }}>
                <span>Total liabilities &amp; equity</span>
                <span>{fmt(totalLiabilities + totalEquity)}</span>
              </div>
            </div>
          )}

          {tab === "cf" && (
            <div className="report-section">
              <h3 className="card-title">Cash Flow Statement</h3>
              {cashAccounts.length === 0 && (
                <p className="cell-muted" style={{ marginBottom: 12 }}>
                  Link a bank account to a Cash-type account in the Chart of Accounts for accurate cash flow reporting. Showing $0 until then.
                </p>
              )}
              <div className="report-line">
                <span>Operating activities</span>
                <span>{fmt(netIncome)}</span>
              </div>
              <div className="report-line">
                <span>Investing activities</span>
                <span>{fmt(0)}</span>
              </div>
              <div className="report-line">
                <span>Financing activities</span>
                <span>{fmt(0)}</span>
              </div>
              <div className="report-line total">
                <span>Net change in cash</span>
                <span>{fmt(netChangeInCash)}</span>
              </div>
              <div className="report-line sub">
                <span>Beginning cash</span>
                <span>{fmt(beginningCash)}</span>
              </div>
              <div className="report-line total" style={{ marginTop: 12, fontSize: 16 }}>
                <span>Ending cash</span>
                <span>{fmt(endingCash)}</span>
              </div>
            </div>
          )}

          {tab === "budget" && (
            <div className="report-section">
              <h3 className="card-title">Budget vs Actual — this month</h3>
              {expenseByCategory.map(([name, value]) => {
                const budget = monthlyBudgets[name] ?? 0;
                const over = value > budget;
                return (
                  <div className="report-line" key={name}>
                    <span>{name}</span>
                    <span>
                      {fmt(value)} <span className="cell-muted">/ {fmt(budget)} budgeted</span>{" "}
                      <span style={{ color: over ? "var(--status-critical)" : "var(--status-good)", fontWeight: 700 }}>
                        {over ? "Over" : "On track"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "forecast" && (
            <div className="report-section">
              <h3 className="card-title">Forecast — next 3 months</h3>
              <p className="card-sub" style={{ marginBottom: 16 }}>
                Naive projection based on the trailing 6-month trend. Not a predictive model.
              </p>
              {forecast.map((f) => (
                <div className="report-line" key={f.month}>
                  <span>{f.month}</span>
                  <span>
                    Income {fmt(f.income)} <span className="cell-muted">·</span> Expenses {fmt(f.expenses)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
