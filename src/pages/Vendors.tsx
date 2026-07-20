import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useCurrency } from "../context/CurrencyContext";
import { currency } from "../lib/format";
import Modal from "../components/Modal";
import { PlusIcon } from "../components/icons";
import type { Vendor } from "../types";

export default function Vendors() {
  const { vendors, addVendor } = useData();
  const { currencyCode } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("Software");

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const reset = () => {
    setName("");
    setEmail("");
    setCategory("Software");
  };

  const submit = () => {
    if (!name.trim() || !email.trim()) return;
    const vendor: Vendor = {
      id: `v${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      category,
      balance: 0,
    };
    addVendor(vendor);
    reset();
    setOpen(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="page-subtitle">{vendors.length} vendors</p>
        </div>
        <button className="btn-new" onClick={() => setOpen(true)}>
          <PlusIcon />
          New vendor
        </button>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Category</th>
              <th>Email</th>
              <th className="cell-num">Balance owed</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td className="cell-muted">{v.category}</td>
                <td className="cell-muted">{v.email}</td>
                <td className="cell-num">{currency(v.balance, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title="New vendor"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                Save vendor
              </button>
            </>
          }
        >
          <div>
            <label>Vendor name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Supplies" />
          </div>
          <div className="field-row">
            <div>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option>Software</option>
                <option>Office Supplies</option>
                <option>Utilities</option>
                <option>Travel</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@acme.com" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
