import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency, formatDate } from "../lib/format";
import { ApiError } from "../lib/apiClient";
import Modal from "../components/Modal";
import { PlusIcon } from "../components/icons";
import type { ExpenseCategory } from "../types";

const categories: ExpenseCategory[] = [
  "Advertising",
  "Office Supplies",
  "Travel",
  "Utilities",
  "Rent",
  "Software",
  "Payroll",
  "Insurance",
  "Other",
];

const today = () => new Date().toISOString().slice(0, 10);

export default function Expenses() {
  const { expenses, vendors, addExpense, isLoading, error: loadError } = useData();
  const { currencyCode } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [date, setDate] = useState(today());
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [category, setCategory] = useState<ExpenseCategory>("Office Supplies");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Credit Card");
  const [memo, setMemo] = useState("");

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "—";
  const totalThisList = expenses.reduce((sum, e) => sum + e.amount, 0);

  const reset = () => {
    setDate(today());
    setVendorId(vendors[0]?.id ?? "");
    setCategory("Office Supplies");
    setAmount("");
    setPaymentMethod("Credit Card");
    setMemo("");
    setFormError("");
  };

  const submit = async () => {
    const value = Number(amount);
    if (!value) return;
    setSubmitting(true);
    setFormError("");
    try {
      await addExpense({
        date,
        vendorId,
        category,
        amount: value,
        paymentMethod,
        memo: memo.trim() || undefined,
      });
      reset();
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save this expense. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            {isLoading ? "Loading…" : `${currency(totalThisList, currencyCode)} total logged`}
          </p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)}>
          <PlusIcon />
          New expense
        </button>
      </div>

      {loadError && <div className="signin-error">{loadError}</div>}

      {expenses.length === 0 && !isLoading && !loadError ? (
        <div className="empty-state">No expenses yet. Record your first expense to get started.</div>
      ) : (
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th>Category</th>
              <th>Payment method</th>
              <th className="cell-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td className="cell-muted">{formatDate(e.date)}</td>
                <td>{vendorName(e.vendorId)}</td>
                <td className="cell-muted">{e.category}</td>
                <td className="cell-muted">{e.paymentMethod}</td>
                <td className="cell-num">{currency(e.amount, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {open && (
        <Modal
          title="New expense"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : "Save expense"}
              </button>
            </>
          }
        >
          {formError && <div className="signin-error">{formError}</div>}
          <div className="field-row">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label>Vendor</label>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Amount</label>
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Payment method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option>Credit Card</option>
                <option>Debit Card</option>
                <option>Bank Transfer</option>
                <option>Cash</option>
              </select>
            </div>
            <div>
              <label>Memo</label>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional note" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
