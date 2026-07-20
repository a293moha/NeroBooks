import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency, initials } from "../lib/format";
import Modal from "../components/Modal";
import { PlusIcon } from "../components/icons";
import type { Customer } from "../types";

export default function Customers() {
  const { customers, addCustomer } = useData();
  const { currencyCode } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const reset = () => {
    setName("");
    setCompany("");
    setEmail("");
    setPhone("");
  };

  const submit = () => {
    if (!name.trim() || !email.trim()) return;
    const customer: Customer = {
      id: `c${Date.now()}`,
      name: name.trim(),
      company: company.trim() || undefined,
      email: email.trim(),
      phone: phone.trim() || undefined,
      balance: 0,
    };
    addCustomer(customer);
    reset();
    setOpen(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} customers</p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)}>
          <PlusIcon />
          New customer
        </button>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Company</th>
              <th>Email</th>
              <th className="cell-num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "var(--brand-yellow-light)",
                        color: "var(--text-primary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {initials(c.name)}
                    </span>
                    {c.name}
                  </div>
                </td>
                <td className="cell-muted">{c.company ?? "—"}</td>
                <td className="cell-muted">{c.email}</td>
                <td className="cell-num">{currency(c.balance, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title="New customer"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                Save customer
              </button>
            </>
          }
        >
          <div>
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label>Company</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." />
          </div>
          <div className="field-row">
            <div>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" />
            </div>
            <div>
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 010-0000" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
