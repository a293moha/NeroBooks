import { useNavigate } from "react-router-dom";
import { CustomersIcon, ExpensesIcon, InvoiceIcon, VendorsIcon } from "./icons";

const items = [
  { to: "/invoices", label: "Invoice", icon: InvoiceIcon },
  { to: "/customers", label: "Customer", icon: CustomersIcon },
  { to: "/expenses", label: "Expense", icon: ExpensesIcon },
  { to: "/vendors", label: "Vendor", icon: VendorsIcon },
];

export default function NewMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  return (
    <div className="dropdown-menu new-menu">
      <div className="dropdown-label">Create new</div>
      {items.map((item) => (
        <div
          key={item.to}
          className="dropdown-item"
          onClick={() => {
            navigate(`${item.to}?new=1`);
            onClose();
          }}
        >
          <span className="nav-icon">
            <item.icon />
          </span>
          {item.label}
        </div>
      ))}
    </div>
  );
}
