import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency } from "../lib/format";
import type { AccountType } from "../types";

const typeColors: Record<AccountType, string> = {
  Asset: "var(--series-blue)",
  Liability: "var(--series-red)",
  Equity: "var(--series-violet)",
  Income: "var(--status-good)",
  Expense: "var(--series-orange)",
};

export default function Accounts() {
  const { accounts } = useData();
  const { currencyCode } = useCurrency();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-subtitle">{accounts.length} accounts</p>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th className="cell-num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="cell-muted">{a.code}</td>
                <td>{a.name}</td>
                <td>
                  <span
                    className="badge"
                    style={{ background: "transparent", border: "1px solid var(--border)", color: typeColors[a.type] }}
                  >
                    <span className="badge-dot" style={{ background: typeColors[a.type] }} />
                    {a.type}
                  </span>
                </td>
                <td className="cell-num">{currency(a.balance, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
