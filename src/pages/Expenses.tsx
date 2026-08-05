import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency, formatDate } from "../lib/format";
import { ApiError } from "../lib/apiClient";
import Modal from "../components/Modal";
import { EditIcon, HistoryIcon, PlusIcon } from "../components/icons";
import type { Expense, ExpenseCategory, ExpenseHistoryEntry } from "../types";

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

const STATUS_LABELS: Record<Expense["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  reimbursed: "Reimbursed",
  rejected: "Rejected",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function Expenses() {
  const { expenses, vendors, addExpense, updateExpense, fetchExpenseHistory, isLoading, error: loadError } = useData();
  const { currencyCode } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ExpenseHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState("");

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
  const detailExpense = detailId ? expenses.find((e) => e.id === detailId) ?? null : null;

  const reset = () => {
    setDate(today());
    setVendorId(vendors[0]?.id ?? "");
    setCategory("Office Supplies");
    setAmount("");
    setPaymentMethod("Credit Card");
    setMemo("");
    setFormError("");
    setEditingId(null);
  };

  const closeModal = () => {
    reset();
    setOpen(false);
  };

  const submit = async () => {
    const value = Number(amount);
    if (!value) return;
    setSubmitting(true);
    setFormError("");
    try {
      if (editingId) {
        await updateExpense(editingId, {
          date,
          vendorId,
          category,
          amount: value,
          paymentMethod,
          memo: memo.trim() || undefined,
        });
      } else {
        await addExpense({
          date,
          vendorId,
          category,
          amount: value,
          paymentMethod,
          memo: memo.trim() || undefined,
        });
      }
      closeModal();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : `Could not save ${editingId ? "these changes" : "this expense"}. Please try again.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (expense: Expense) => {
    if (expense.status !== "pending") {
      const confirmed = window.confirm(
        `This expense is already marked "${STATUS_LABELS[expense.status]}" and may be part of a finalized report or reconciliation. Editing it changes financial records that have already been finalized. Continue?`
      );
      if (!confirmed) return;
    }
    setFormError("");
    setDate(expense.date.slice(0, 10));
    setVendorId(expense.vendorId);
    setCategory(expense.category);
    setAmount(String(expense.amount));
    setPaymentMethod(expense.paymentMethod);
    setMemo(expense.memo ?? "");
    setEditingId(expense.id);
    setDetailId(null);
    setOpen(true);
  };

  const openHistory = async (expense: Expense) => {
    setHistoryId(expense.id);
    setHistoryEntries(null);
    setHistoryError("");
    try {
      const entries = await fetchExpenseHistory(expense.id);
      setHistoryEntries(entries);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "Could not load this expense's history.");
    }
  };

  const closeHistory = () => {
    setHistoryId(null);
    setHistoryEntries(null);
    setHistoryError("");
  };

  const formatChangeValue = (field: string, value: string | number | null) => {
    if (value === null || value === undefined) return "—";
    if (field === "amount") return currency(Number(value), currencyCode);
    if (field === "date") return formatDate(String(value));
    return String(value);
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="clickable-row" onClick={() => setDetailId(e.id)}>
                <td className="cell-muted">{formatDate(e.date)}</td>
                <td>{vendorName(e.vendorId)}</td>
                <td className="cell-muted">{e.category}</td>
                <td className="cell-muted">{e.paymentMethod}</td>
                <td className="cell-num">{currency(e.amount, currencyCode)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn-secondary icon-btn"
                      title="Edit history"
                      aria-label="Edit history"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openHistory(e);
                      }}
                    >
                      <HistoryIcon width={14} height={14} />
                    </button>
                    <button
                      className="btn-secondary icon-btn"
                      title="Edit expense"
                      aria-label="Edit expense"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        startEdit(e);
                      }}
                    >
                      <EditIcon width={14} height={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {open && (
        <Modal
          title={editingId ? "Edit expense" : "New expense"}
          onClose={closeModal}
          footer={
            <>
              <button className="btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : editingId ? "Save changes" : "Save expense"}
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

      {detailExpense && (
        <Modal
          title="Expense details"
          onClose={() => setDetailId(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDetailId(null)}>
                Close
              </button>
              <button className="btn-primary" onClick={() => startEdit(detailExpense)}>
                Edit
              </button>
            </>
          }
        >
          <div className="field-row">
            <div>
              <label>Date</label>
              <p>{formatDate(detailExpense.date)}</p>
            </div>
            <div>
              <label>Vendor</label>
              <p>{vendorName(detailExpense.vendorId)}</p>
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Category</label>
              <p>{detailExpense.category}</p>
            </div>
            <div>
              <label>Amount</label>
              <p>{currency(detailExpense.amount, currencyCode)}</p>
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Payment method</label>
              <p>{detailExpense.paymentMethod}</p>
            </div>
            <div>
              <label>Memo</label>
              <p>{detailExpense.memo || "—"}</p>
            </div>
          </div>
        </Modal>
      )}

      {historyId && (
        <Modal title="Edit history" onClose={closeHistory} footer={<button className="btn-secondary" onClick={closeHistory}>Close</button>}>
          {historyError && <div className="signin-error">{historyError}</div>}
          {!historyError && !historyEntries && <p className="cell-muted">Loading…</p>}
          {historyEntries && historyEntries.length === 0 && <p className="cell-muted">No history recorded yet.</p>}
          {historyEntries && historyEntries.length > 0 && (
            <div className="history-list">
              {historyEntries.map((entry) => (
                <div className="history-entry" key={entry.id}>
                  <div className="history-entry-date">{formatDate(entry.createdAt)}</div>
                  {entry.action === "expense.created" ? (
                    <div>Created</div>
                  ) : entry.changes.length === 0 ? (
                    <div className="cell-muted">{entry.action.replace("expense.", "")}</div>
                  ) : (
                    <ul>
                      {entry.changes.map((change) => (
                        <li key={change.field}>
                          {change.label} changed from {formatChangeValue(change.field, change.from)} to{" "}
                          {formatChangeValue(change.field, change.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
