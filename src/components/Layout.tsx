import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  AccountsIcon,
  BillingIcon,
  CustomersIcon,
  DashboardIcon,
  ExpensesIcon,
  InvoiceIcon,
  PlusIcon,
  ReportsIcon,
  SearchIcon,
  TeamIcon,
  TransactionsIcon,
  VendorsIcon,
} from "./icons";
import NewMenu from "./NewMenu";
import UserMenu from "./UserMenu";
import { useAuth } from "../context/AuthContext";
import { initials } from "../lib/format";

const navGroups = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: DashboardIcon }],
  },
  {
    label: "Sales",
    items: [
      { to: "/invoices", label: "Invoices", icon: InvoiceIcon },
      { to: "/customers", label: "Customers", icon: CustomersIcon },
    ],
  },
  {
    label: "Expenses",
    items: [
      { to: "/expenses", label: "Expenses", icon: ExpensesIcon },
      { to: "/vendors", label: "Vendors", icon: VendorsIcon },
    ],
  },
  {
    label: "Accounting",
    items: [
      { to: "/accounts", label: "Chart of Accounts", icon: AccountsIcon },
      { to: "/transactions", label: "Transactions", icon: TransactionsIcon },
      { to: "/reports", label: "Reports", icon: ReportsIcon },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/team", label: "Team", icon: TeamIcon },
      { to: "/billing", label: "Billing", icon: BillingIcon },
    ],
  },
];

const platformNavGroup = {
  label: "Platform",
  items: [{ to: "/admin", label: "Admin", icon: TeamIcon }],
};

export default function Layout() {
  const { user } = useAuth();
  const groups = user?.isPlatformAdmin ? [...navGroups, platformNavGroup] : navGroups;
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark">NB</span>
          <span>NeroBooks</span>
        </Link>
        <div className="header-search">
          <div style={{ position: "relative" }}>
            <SearchIcon
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
            <input style={{ paddingLeft: 36 }} placeholder="Search invoices, customers, transactions…" />
          </div>
        </div>
        <div className="header-actions">
          <div className="dropdown-anchor" ref={newMenuRef}>
            <button className="btn-new" onClick={() => setNewMenuOpen((v) => !v)}>
              <PlusIcon />
              New
            </button>
            {newMenuOpen && <NewMenu onClose={() => setNewMenuOpen(false)} />}
          </div>
          <div className="dropdown-anchor" ref={userMenuRef}>
            <div className="avatar-chip" onClick={() => setUserMenuOpen((v) => !v)}>
              {user ? initials(user.name) : "?"}
            </div>
            {userMenuOpen && <UserMenu onClose={() => setUserMenuOpen(false)} />}
          </div>
        </div>
      </header>
      <nav className="sidebar">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                end={item.to === "/"}
              >
                <span className="nav-icon">
                  <item.icon />
                </span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
