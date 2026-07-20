import { useMemo, useState } from "react";
import { countries, flagEmoji, type Country } from "../lib/countries";

export default function CountryPicker({ onSelect }: { onSelect: (country: Country) => void }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q) || c.currency.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="currency-picker">
      <input
        className="currency-picker-search"
        placeholder="Search countries…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="currency-picker-list country-picker-list">
        {filtered.length === 0 ? (
          <div className="currency-picker-empty">No countries match "{query}"</div>
        ) : (
          filtered.map((c) => (
            <div key={c.code} className="currency-picker-item" onClick={() => onSelect(c)}>
              <span className="currency-picker-symbol">{flagEmoji(c.code)}</span>
              <span className="currency-picker-name">{c.name}</span>
              <span className="currency-picker-code">{c.currency}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
