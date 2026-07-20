import { useMemo, useState } from "react";
import { useCurrency } from "../context/CurrencyContext";

export default function CurrencyPicker({ onSelect }: { onSelect?: () => void }) {
  const { currencyCode, setCurrencyCode, currencyOptions } = useCurrency();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return currencyOptions;
    return currencyOptions.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [query, currencyOptions]);

  return (
    <div className="currency-picker">
      <input
        className="currency-picker-search"
        placeholder="Search currencies…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="currency-picker-list">
        {filtered.length === 0 ? (
          <div className="currency-picker-empty">No currencies match "{query}"</div>
        ) : (
          filtered.map((c) => (
            <div
              key={c.code}
              className={`currency-picker-item ${c.code === currencyCode ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setCurrencyCode(c.code);
                onSelect?.();
              }}
            >
              <span className="currency-picker-symbol">{c.symbol}</span>
              <span className="currency-picker-code">{c.code}</span>
              <span className="currency-picker-name">{c.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
