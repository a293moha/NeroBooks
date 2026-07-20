import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { useAuth } from "../context/AuthContext";
import { planLimits } from "../lib/planLimits";
import { currency, formatDate, invoiceTotal } from "../lib/format";
import Modal from "../components/Modal";
import StatusBadge from "../components/StatusBadge";
import UpgradeBanner from "../components/UpgradeBanner";
import { PlusIcon } from "../components/icons";
import type { Invoice, InvoiceLineItem } from "../types";

const today = () => new Date().toISOString().slice(0, 10);
const in30Days = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function emptyLine(): InvoiceLineItem {
  return { id: `li${Date.now()}${Math.random()}`, description: "", qty: 1, rate: 0 };
}

export default function Invoices() {
  const { invoices, customers, addInvoice } = useData();
  const { currencyCode, currencyOptions } = useCurrency();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | Invoice["status"]>("all");

  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(in30Days());
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([emptyLine()]);
  const [invoiceCurrency, setInvoiceCurrency] = useState(currencyCode);

  const canUseMultiCurrency = user ? planLimits[user.plan].multiCurrencyInvoicing : false;

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "—";

  const filtered = filter === "all" ? invoices : invoices.filter((i) => i.status === filter);

  const updateLine = (id: string, patch: Partial<InvoiceLineItem>) =>
    setLineItems((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) => setLineItems((prev) => prev.filter((l) => l.id !== id));

  const total = lineItems.reduce((sum, l) => sum + l.qty * l.rate, 0);

  const reset = () => {
    setCustomerId(customers[0]?.id ?? "");
    setIssueDate(today());
    setDueDate(in30Days());
    setLineItems([emptyLine()]);
    setInvoiceCurrency(currencyCode);
  };

  const submit = (status: Invoice["status"]) => {
    if (!customerId || lineItems.every((l) => !l.description.trim())) return;
    const nextNumber = 1000 + invoices.length + 1;
    const invoice: Invoice = {
      id: `i${Date.now()}`,
      number: `INV-${nextNumber}`,
      customerId,
      issueDate,
      dueDate,
      status,
      lineItems: lineItems.filter((l) => l.description.trim()),
      currency: canUseMultiCurrency && invoiceCurrency !== currencyCode ? invoiceCurrency : undefined,
    };
    addInvoice(invoice);
    reset();
    setOpen(false);
  };

  const tabs: { key: "all" | Invoice["status"]; label: string }[] = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "paid", label: "Paid" },
    { key: "overdue", label: "Overdue" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{invoices.length} total invoices</p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)}>
          <PlusIcon />
          New invoice
        </button>
      </div>

      <div className="tab-row">
        {tabs.map((t) => (
          <div key={t.key} className={`tab-item ${filter === t.key ? "active" : ""}`} onClick={() => setFilter(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      <div className="table-card">
        {filtered.length === 0 ? (
          <div className="empty-state">No invoices in this view yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issue date</th>
                <th>Due date</th>
                <th>Status</th>
                <th className="cell-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td>
                  <td className="cell-muted">{customerName(inv.customerId)}</td>
                  <td className="cell-muted">{formatDate(inv.issueDate)}</td>
                  <td className="cell-muted">{formatDate(inv.dueDate)}</td>
                  <td>
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="cell-num">
                    {currency(invoiceTotal(inv), inv.currency ?? currencyCode)}
                    {inv.currency && inv.currency !== currencyCode && (
                      <span className="cell-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                        ({inv.currency})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal
          title="New invoice"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-secondary" onClick={() => submit("draft")}>
                Save as draft
              </button>
              <button className="btn-primary" onClick={() => submit("sent")}>
                Save &amp; send
              </button>
            </>
          }
        >
          <div className="field-row">
            <div>
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Currency {!canUseMultiCurrency && "🔒"}</label>
              {canUseMultiCurrency ? (
                <select value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value)}>
                  {currencyOptions.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={`${currencyCode} (account default)`} disabled />
              )}
            </div>
          </div>

          {!canUseMultiCurrency && (
            <UpgradeBanner message="Starter invoices always use your account currency. Upgrade to Pro to bill customers in any currency." />
          )}
          <div className="field-row">
            <div>
              <label>Issue date</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div>
              <label>Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label>Line items</label>
            <div className="line-items-table">
              {lineItems.map((line) => (
                <div className="line-item-row" key={line.id}>
                  <input
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, { description: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    min={0}
                    value={line.rate}
                    onChange={(e) => updateLine(line.id, { rate: Number(e.target.value) })}
                  />
                  <button className="remove-line-btn" onClick={() => removeLine(line.id)} title="Remove line">
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="add-line-btn" onClick={() => setLineItems((prev) => [...prev, emptyLine()])}>
              + Add line item
            </button>
          </div>

          <div className="invoice-total-line">
            <span>Total</span>
            <span>{currency(total, canUseMultiCurrency ? invoiceCurrency : currencyCode)}</span>
          </div>
        </Modal>
      )}
    </div>
  );
}
