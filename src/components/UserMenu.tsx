import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useCurrency } from "../context/CurrencyContext";
import CurrencyPicker from "./CurrencyPicker";
import { initials } from "../lib/format";

export default function UserMenu({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth();
  const { currencyCode, currencyOptions } = useCurrency();
  const [showCurrency, setShowCurrency] = useState(false);

  const currentCurrency = currencyOptions.find((c) => c.code === currencyCode);

  return (
    <div className="dropdown-menu user-menu" onClick={(e) => e.stopPropagation()}>
      <div className="user-menu-header">
        <div className="avatar-chip">{user ? initials(user.name) : "?"}</div>
        <div>
          <div className="user-menu-name">{user?.name}</div>
          <div className="user-menu-email">{user?.email}</div>
        </div>
      </div>

      <div className="dropdown-divider" />

      {!showCurrency ? (
        <div className="dropdown-item" onClick={() => setShowCurrency(true)}>
          <span>Currency</span>
          <span className="dropdown-item-value">
            {currentCurrency?.symbol} {currencyCode}
          </span>
        </div>
      ) : (
        <div className="currency-picker-wrap">
          <div className="dropdown-item back-item" onClick={() => setShowCurrency(false)}>
            ← Back
          </div>
          <CurrencyPicker onSelect={() => setShowCurrency(false)} />
        </div>
      )}

      <div className="dropdown-divider" />

      <div
        className="dropdown-item"
        onClick={() => {
          signOut();
          onClose();
        }}
      >
        Sign out
      </div>
    </div>
  );
}
