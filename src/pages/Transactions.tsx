import { useEffect, useState } from "react";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency, formatDate } from "../lib/format";
import { ApiError } from "../lib/apiClient";
import Modal from "../components/Modal";
import Toast from "../components/Toast";
import { PlusIcon, TrashIcon } from "../components/icons";
import type { JournalEntry, JournalEntryStatus } from "../types";

const STATUS_LABELS: Record<JournalEntryStatus, string> = { draft: "Draft", posted: "Posted", void: "Void" };
const STATUS_CLASS: Record<JournalEntryStatus, string> = { draft: "draft", posted: "paid", void: "draft" };

const today = () => new Date().toISOString().slice(0, 10);

interface EditableLine {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}
function emptyLine(): EditableLine {
  return { id: `jl${Date.now()}${Math.random()}`, accountId: "", debit: 0, credit: 0, description: "" };
}

export default function Transactions() {
  const { journalEntries, accounts, addJournalEntry, updateJournalEntry, postJournalEntry, deleteJournalEntry, isLoading, error: loadError } =
    useData();
  const { currencyCode } = useCurrency();

  const [filter, setFilter] = useState<"all" | JournalEntryStatus>("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const [entryDate, setEntryDate] = useState(today());
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine(), emptyLine()]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const activeAccounts = accounts.filter((a) => a.isActive);
  const detailEntry = detailId ? journalEntries.find((e) => e.id === detailId) ?? null : null;

  const filteredEntries = filter === "all" ? journalEntries : journalEntries.filter((e) => e.status === filter);
  const rows = filteredEntries.flatMap((entry) => entry.lines.map((line) => ({ entry, line })));

  const reset = () => {
    setEntryDate(today());
    setReference("");
    setDescription("");
    setLines([emptyLine(), emptyLine()]);
    setFormError("");
    setEditingId(null);
  };

  const closeModal = () => {
    reset();
    setOpen(false);
  };

  const updateLine = (id: string, patch: Partial<EditableLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const difference = totalDebit - totalCredit;
  const validLineCount = lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0)).length;
  const balanced = Math.abs(difference) < 0.005 && totalDebit > 0 && validLineCount >= 2;

  const buildLinesPayload = () =>
    lines
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0))
      .map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description.trim() || undefined }));

  const submitNew = async (post: boolean) => {
    const payload = buildLinesPayload();
    if (payload.length < 2 || !entryDate) return;
    setSubmitting(true);
    setFormError("");
    try {
      await addJournalEntry({
        entryDate,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        lines: payload,
        post,
      });
      setToast(post ? "Journal entry posted." : "Journal entry saved as draft.");
      closeModal();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save this journal entry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    const payload = buildLinesPayload();
    if (payload.length < 2 || !entryDate) return;
    setSubmitting(true);
    setFormError("");
    try {
      await updateJournalEntry(editingId, {
        entryDate,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        lines: payload,
      });
      setToast("Journal entry updated.");
      closeModal();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (entry: JournalEntry) => {
    setFormError("");
    setEntryDate(entry.entryDate.slice(0, 10));
    setReference(entry.reference ?? "");
    setDescription(entry.description ?? "");
    setLines(
      entry.lines.map((l) => ({ id: l.id, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? "" }))
    );
    setEditingId(entry.id);
    setDetailId(null);
    setOpen(true);
  };

  const confirmDeleteEntry = async (entry: JournalEntry) => {
    const confirmed = window.confirm("Are you sure you want to delete this journal entry? This action cannot be undone.");
    if (!confirmed) return;
    setActioningId(entry.id);
    setActionError("");
    try {
      await deleteJournalEntry(entry.id);
      setDetailId(null);
      setToast("Journal entry deleted.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete this journal entry. Please try again.");
    } finally {
      setActioningId(null);
    }
  };

  const confirmPost = async (entry: JournalEntry) => {
    setActioningId(entry.id);
    setActionError("");
    try {
      await postJournalEntry(entry.id);
      setDetailId(null);
      setToast("Journal entry posted.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not post this journal entry. Please try again.");
    } finally {
      setActioningId(null);
    }
  };

  const tabs: { key: "all" | JournalEntryStatus; label: string }[] = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "posted", label: "Posted" },
    { key: "void", label: "Void" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{isLoading ? "Loading…" : "General ledger register"}</p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)} disabled={activeAccounts.length < 2}>
          <PlusIcon />
          New journal entry
        </button>
      </div>

      {loadError && <div className="signin-error">{loadError}</div>}
      {actionError && <div className="signin-error">{actionError}</div>}
      {activeAccounts.length < 2 && !isLoading && !loadError && (
        <div className="empty-state">Add at least two accounts in the Chart of Accounts before recording a journal entry.</div>
      )}

      <div className="tab-row">
        {tabs.map((t) => (
          <div key={t.key} className={`tab-item ${filter === t.key ? "active" : ""}`} onClick={() => setFilter(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      <div className="table-card">
        {rows.length === 0 ? (
          <div className="empty-state">
            {journalEntries.length === 0 ? "No journal entries yet. Record your first entry to get started." : "No entries in this view yet."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th className="cell-num">Debit</th>
                <th className="cell-num">Credit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, line }) => (
                <tr key={line.id} className="clickable-row" onClick={() => setDetailId(entry.id)}>
                  <td className="cell-muted">{formatDate(entry.entryDate)}</td>
                  <td>{entry.description || entry.reference || "—"}</td>
                  <td className="cell-muted">
                    {line.accountCode} {line.accountName}
                  </td>
                  <td className="cell-num">{line.debit ? currency(line.debit, currencyCode) : "—"}</td>
                  <td className="cell-num">{line.credit ? currency(line.credit, currencyCode) : "—"}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[entry.status]}`}>
                      <span className="badge-dot" />
                      {STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal
          title={editingId ? "Edit journal entry" : "New journal entry"}
          onClose={closeModal}
          footer={
            editingId ? (
              <>
                <button className="btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={submitEdit} disabled={submitting}>
                  {submitting ? "Saving…" : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <button className="btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button className="btn-secondary" onClick={() => submitNew(false)} disabled={submitting}>
                  {submitting ? "Saving…" : "Save as draft"}
                </button>
                <button className="btn-primary" onClick={() => submitNew(true)} disabled={submitting || !balanced}>
                  {submitting ? "Posting…" : "Post"}
                </button>
              </>
            )
          }
        >
          {formError && <div className="signin-error">{formError}</div>}
          <div className="field-row">
            <div>
              <label>Entry date</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div>
              <label>Reference</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div>
            <label>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>

          <div>
            <label>Lines</label>
            <div className="line-items-table">
              {lines.map((line) => (
                <div className="journal-line-row" key={line.id}>
                  <select value={line.accountId} onChange={(e) => updateLine(line.id, { accountId: e.target.value })}>
                    <option value="">Select account</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, { description: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    value={line.debit}
                    onChange={(e) => updateLine(line.id, { debit: Number(e.target.value), credit: 0 })}
                  />
                  <input
                    type="number"
                    min={0}
                    value={line.credit}
                    onChange={(e) => updateLine(line.id, { credit: Number(e.target.value), debit: 0 })}
                  />
                  <button className="remove-line-btn" onClick={() => removeLine(line.id)} title="Remove line">
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="add-line-btn" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              + Add line
            </button>
          </div>

          <div className="invoice-total-line">
            <span>
              Debits: {currency(totalDebit, currencyCode)} · Credits: {currency(totalCredit, currencyCode)}
            </span>
            <span style={{ color: balanced ? "var(--status-good)" : "var(--status-critical)" }}>
              {balanced ? "Balanced" : `Difference: ${currency(Math.abs(difference), currencyCode)}`}
            </span>
          </div>
        </Modal>
      )}

      {detailEntry && (
        <Modal
          title="Journal entry"
          onClose={() => setDetailId(null)}
          footer={
            detailEntry.status === "draft" ? (
              <>
                <button
                  className="btn-secondary icon-btn icon-btn-danger"
                  onClick={() => confirmDeleteEntry(detailEntry)}
                  disabled={actioningId === detailEntry.id}
                  title="Delete journal entry"
                  aria-label="Delete journal entry"
                >
                  <TrashIcon width={14} height={14} />
                </button>
                <button className="btn-secondary" onClick={() => startEdit(detailEntry)}>
                  Edit
                </button>
                <button className="btn-primary" onClick={() => confirmPost(detailEntry)} disabled={actioningId === detailEntry.id}>
                  {actioningId === detailEntry.id ? "Posting…" : "Post"}
                </button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => setDetailId(null)}>
                Close
              </button>
            )
          }
        >
          <div className="field-row">
            <div>
              <label>Date</label>
              <p>{formatDate(detailEntry.entryDate)}</p>
            </div>
            <div>
              <label>Status</label>
              <p>{STATUS_LABELS[detailEntry.status]}</p>
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Reference</label>
              <p>{detailEntry.reference || "—"}</p>
            </div>
            <div>
              <label>Description</label>
              <p>{detailEntry.description || "—"}</p>
            </div>
          </div>
          <div>
            <label>Lines</label>
            <div className="line-items-table">
              {detailEntry.lines.map((line) => (
                <div className="journal-line-view-row" key={line.id}>
                  <span>
                    {line.accountCode} — {line.accountName}
                  </span>
                  <span className="cell-muted">{line.description || "—"}</span>
                  <span className="cell-num">{line.debit ? currency(line.debit, currencyCode) : "—"}</span>
                  <span className="cell-num">{line.credit ? currency(line.credit, currencyCode) : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
