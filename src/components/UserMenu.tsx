import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCurrency } from "../context/CurrencyContext";
import CurrencyPicker from "./CurrencyPicker";
import { initials } from "../lib/format";
import { planLimits } from "../lib/planLimits";

export default function UserMenu({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth();
  const { currencyCode, currencyOptions } = useCurrency();
  const navigate = useNavigate();
  const [showCurrency, setShowCurrency] = useState(false);

  if (!user) return null;

  const currentCurrency = currencyOptions.find((c) => c.code === currencyCode);
  const canSwitchCurrency = planLimits[user.plan].multiCurrencyInvoicing;

  return (
    <div className="dropdown-menu user-menu" onClick={(e) => e.stopPropagation()}>
      <div className="user-menu-header">
        <div className="avatar-chip">{initials(user.name)}</div>
        <div>
          <div className="user-menu-name">{user.name}</div>
          <div className="user-menu-email">{user.email}</div>
        </div>
      </div>

      <div className="dropdown-divider" />

      <div
        className="dropdown-item"
        onClick={() => {
          navigate("/billing");
          onClose();
        }}
      >
        <span>Plan</span>
        <span className="dropdown-item-value">{planLimits[user.plan].label}</span>
      </div>

      {!showCurrency ? (
        <div
          className="dropdown-item"
          onClick={() => {
            if (canSwitchCurrency) setShowCurrency(true);
            else navigate("/billing");
            if (!canSwitchCurrency) onClose();
          }}
        >
          <span>Currency {!canSwitchCurrency && "🔒"}</span>
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
