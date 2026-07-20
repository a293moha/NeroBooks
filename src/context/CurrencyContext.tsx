import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { currencies, type CurrencyOption } from "../lib/currencies";

const STORAGE_KEY = "nerobooks-currency";

interface CurrencyContextValue {
  currencyCode: string;
  setCurrencyCode: (code: string) => void;
  currencyOptions: CurrencyOption[];
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currencyCode, setCurrencyCode] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || "USD");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currencyCode);
  }, [currencyCode]);

  return (
    <CurrencyContext.Provider value={{ currencyCode, setCurrencyCode, currencyOptions: currencies }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
