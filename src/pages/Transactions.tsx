import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency, formatDate } from "../lib/format";

export default function Transactions() {
  const { transactions, accounts } = useData();
  const { currencyCode } = useCurrency();
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">General ledger register</p>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Account</th>
              <th className="cell-num">Debit</th>
              <th className="cell-num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td className="cell-muted">{formatDate(t.date)}</td>
                <td>{t.description}</td>
                <td className="cell-muted">{accountName(t.accountId)}</td>
                <td className="cell-num">{t.debit ? currency(t.debit, currencyCode) : "—"}</td>
                <td className="cell-num">{t.credit ? currency(t.credit, currencyCode) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
