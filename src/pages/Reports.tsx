import { useState } from "react";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { useAuth } from "../context/AuthContext";
import { planLimits } from "../lib/planLimits";
import { currency } from "../lib/format";
import UpgradeBanner from "../components/UpgradeBanner";

type Tab = "pl" | "bs" | "cf";

export default function Reports() {
  const { accounts, expenses } = useData();
  const { currencyCode } = useCurrency();
  const { user } = useAuth();
  const fmt = (amount: number) => currency(amount, currencyCode);
  const [tab, setTab] = useState<Tab>("pl");

  if (!user) return null;
  const canUseAdvanced = planLimits[user.plan].advancedReports;
  const canExport = planLimits[user.plan].exportReports;

  const income = accounts.filter((a) => a.type === "Income");
  const expenseAccounts = accounts.filter((a) => a.type === "Expense");
  const totalIncome = income.reduce((sum, a) => sum + a.balance, 0);
  const totalExpenseAccount = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
  const netIncome = totalIncome - totalExpenseAccount;

  const expenseByCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {})
  );

  const assets = accounts.filter((a) => a.type === "Asset");
  const liabilities = accounts.filter((a) => a.type === "Liability");
  const equity = accounts.filter((a) => a.type === "Equity");
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);

  const endingCash = accounts.find((a) => a.code === "1000")?.balance ?? 0;
  const netChangeInCash = netIncome;
  const beginningCash = endingCash - netChangeInCash;

  const exportCsv = () => {
    if (!canExport) return;
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
    } else {
      rows = [
        ["Cash Flow Statement"],
        ["Operating activities", netIncome.toFixed(2)],
        ["Investing activities", "0.00"],
        ["Financing activities", "0.00"],
        ["Net change in cash", netChangeInCash.toFixed(2)],
        ["Beginning cash", beginningCash.toFixed(2)],
        ["Ending cash", endingCash.toFixed(2)],
      ];
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Year to date</p>
        </div>
        <button className={canExport ? "btn-secondary" : "btn-secondary"} onClick={exportCsv} disabled={!canExport}>
          {canExport ? "Export CSV" : "🔒 Export CSV"}
        </button>
      </div>

      <div className="tab-row">
        <div className={`tab-item ${tab === "pl" ? "active" : ""}`} onClick={() => setTab("pl")}>
          Profit &amp; Loss
        </div>
        <div className={`tab-item ${tab === "bs" ? "active" : ""}`} onClick={() => setTab("bs")}>
          Balance Sheet
        </div>
        <div
          className={`tab-item ${tab === "cf" ? "active" : ""}`}
          onClick={() => setTab("cf")}
          title={canUseAdvanced ? undefined : "Pro feature"}
        >
          Cash Flow {!canUseAdvanced && "🔒"}
        </div>
      </div>

      {tab === "cf" && !canUseAdvanced ? (
        <UpgradeBanner message="Cash Flow statements are a Pro feature." />
      ) : (
        <>
          {!canExport && (
            <UpgradeBanner message="Exporting reports to CSV is a Pro feature." />
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

          {tab === "cf" && canUseAdvanced && (
            <div className="report-section">
              <h3 className="card-title">Cash Flow Statement</h3>
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
        </>
      )}
    </div>
  );
}
