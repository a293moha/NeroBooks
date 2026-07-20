import { useState } from "react";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency } from "../lib/format";

export default function Reports() {
  const { accounts, expenses } = useData();
  const { currencyCode } = useCurrency();
  const fmt = (amount: number) => currency(amount, currencyCode);
  const [tab, setTab] = useState<"pl" | "bs">("pl");

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Year to date</p>
        </div>
      </div>

      <div className="tab-row">
        <div className={`tab-item ${tab === "pl" ? "active" : ""}`} onClick={() => setTab("pl")}>
          Profit &amp; Loss
        </div>
        <div className={`tab-item ${tab === "bs" ? "active" : ""}`} onClick={() => setTab("bs")}>
          Balance Sheet
        </div>
      </div>

      {tab === "pl" ? (
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
      ) : (
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
    </div>
  );
}
