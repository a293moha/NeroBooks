import { useEffect, useState } from "react";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { accountTypeLabel, currency } from "../lib/format";
import { ApiError } from "../lib/apiClient";
import Modal from "../components/Modal";
import Toast from "../components/Toast";
import { EditIcon, PlusIcon, TrashIcon } from "../components/icons";
import type { Account, AccountType } from "../types";

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const typeColors: Record<AccountType, string> = {
  asset: "var(--series-blue)",
  liability: "var(--series-red)",
  equity: "var(--series-violet)",
  income: "var(--status-good)",
  expense: "var(--series-orange)",
};

export default function Accounts() {
  const { accounts, addAccount, updateAccount, deleteAccount, isLoading, error: loadError } = useData();
  const { currencyCode } = useCurrency();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("asset");
  const [parentAccountId, setParentAccountId] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const reset = () => {
    setCode("");
    setName("");
    setType("asset");
    setParentAccountId("");
    setFormError("");
    setEditingId(null);
  };

  const closeModal = () => {
    reset();
    setOpen(false);
  };

  // An account can't be its own ancestor -- excludes itself and every
  // descendant from the parent picker. The server independently enforces
  // this (a bounded ancestor walk), this is just so the UI doesn't offer
  // an option that would always be rejected.
  const descendantIds = (rootId: string): Set<string> => {
    const ids = new Set<string>();
    let frontier = [rootId];
    while (frontier.length > 0) {
      const next = accounts.filter((a) => frontier.includes(a.parentAccountId ?? "")).map((a) => a.id);
      next.forEach((id) => ids.add(id));
      frontier = next;
    }
    return ids;
  };
  const excludedParentIds = editingId ? new Set([editingId, ...descendantIds(editingId)]) : new Set<string>();
  const parentOptions = accounts.filter((a) => !excludedParentIds.has(a.id));

  const startEdit = (account: Account) => {
    setFormError("");
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setParentAccountId(account.parentAccountId ?? "");
    setEditingId(account.id);
    setOpen(true);
  };

  const submit = async () => {
    if (!code.trim() || !name.trim()) return;
    setSubmitting(true);
    setFormError("");
    try {
      if (editingId) {
        await updateAccount(editingId, {
          code: code.trim(),
          name: name.trim(),
          type,
          parentAccountId: parentAccountId || null,
          isActive: accounts.find((a) => a.id === editingId)?.isActive ?? true,
        });
        setToast("Account updated.");
      } else {
        await addAccount({ code: code.trim(), name: name.trim(), type, parentAccountId: parentAccountId || undefined });
        setToast("Account created.");
      }
      closeModal();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save this account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (account: Account) => {
    setActioningId(account.id);
    setActionError("");
    try {
      await updateAccount(account.id, {
        code: account.code,
        name: account.name,
        type: account.type,
        parentAccountId: account.parentAccountId,
        isActive: !account.isActive,
      });
      setToast(account.isActive ? "Account deactivated." : "Account reactivated.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update this account. Please try again.");
    } finally {
      setActioningId(null);
    }
  };

  const confirmDelete = async (account: Account) => {
    const confirmed = window.confirm(`Are you sure you want to delete ${account.code} — ${account.name}? This action cannot be undone.`);
    if (!confirmed) return;
    setActioningId(account.id);
    setActionError("");
    try {
      await deleteAccount(account.id);
      setToast("Account deleted.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete this account. Please try again.");
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-subtitle">{isLoading ? "Loading…" : `${accounts.length} accounts`}</p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)}>
          <PlusIcon />
          New account
        </button>
      </div>

      {loadError && <div className="signin-error">{loadError}</div>}
      {actionError && <div className="signin-error">{actionError}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th className="cell-num">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={a.isActive ? undefined : { opacity: 0.55 }}>
                <td className="cell-muted">{a.code}</td>
                <td>
                  {a.name}
                  {!a.isActive && (
                    <span className="cell-muted" style={{ marginLeft: 8, fontSize: 11 }}>
                      Inactive
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className="badge"
                    style={{ background: "transparent", border: "1px solid var(--border)", color: typeColors[a.type] }}
                  >
                    <span className="badge-dot" style={{ background: typeColors[a.type] }} />
                    {accountTypeLabel(a.type)}
                  </span>
                </td>
                <td className="cell-num">{currency(a.balance, currencyCode)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn-secondary icon-btn"
                      onClick={() => startEdit(a)}
                      title="Edit account"
                      aria-label="Edit account"
                    >
                      <EditIcon width={14} height={14} />
                    </button>
                    {a.hasActivity ? (
                      <button
                        className="btn-secondary"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        disabled={actioningId === a.id}
                        onClick={() => toggleActive(a)}
                      >
                        {actioningId === a.id ? "…" : a.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    ) : (
                      <button
                        className="btn-secondary icon-btn icon-btn-danger"
                        onClick={() => confirmDelete(a)}
                        disabled={actioningId === a.id}
                        title="Delete account"
                        aria-label="Delete account"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title={editingId ? "Edit account" : "New account"}
          onClose={closeModal}
          footer={
            <>
              <button className="btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : editingId ? "Save changes" : "Save account"}
              </button>
            </>
          }
        >
          {formError && <div className="signin-error">{formError}</div>}
          <div className="field-row">
            <div>
              <label>Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1000" />
            </div>
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business Checking" />
            </div>
          </div>
          <div className="field-row">
            <div>
              <label>Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
                disabled={!!editingId && (accounts.find((a) => a.id === editingId)?.hasActivity ?? false)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {accountTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Parent account</label>
              <select value={parentAccountId} onChange={(e) => setParentAccountId(e.target.value)}>
                <option value="">None</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
