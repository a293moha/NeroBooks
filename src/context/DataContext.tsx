import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account, Customer, Expense, Invoice, Transaction, Vendor } from "../types";
import {
  seedAccounts,
  seedCustomers,
  seedExpenses,
  seedInvoices,
  seedTransactions,
  seedVendors,
} from "../lib/seed";

const STORAGE_KEY = "nerobooks-data-v1";

interface StoreShape {
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  expenses: Expense[];
  accounts: Account[];
  transactions: Transaction[];
}

function loadInitial(): StoreShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as StoreShape;
    } catch {
      // fall through to seed
    }
  }
  return {
    customers: seedCustomers,
    vendors: seedVendors,
    invoices: seedInvoices,
    expenses: seedExpenses,
    accounts: seedAccounts,
    transactions: seedTransactions,
  };
}

interface DataContextValue extends StoreShape {
  addInvoice: (invoice: Invoice) => void;
  updateInvoice: (invoice: Invoice) => void;
  addCustomer: (customer: Customer) => void;
  addExpense: (expense: Expense) => void;
  addVendor: (vendor: Vendor) => void;
  resetDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<StoreShape>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const addInvoice = (invoice: Invoice) =>
    setStore((prev) => ({ ...prev, invoices: [invoice, ...prev.invoices] }));

  const updateInvoice = (invoice: Invoice) =>
    setStore((prev) => ({
      ...prev,
      invoices: prev.invoices.map((i) => (i.id === invoice.id ? invoice : i)),
    }));

  const addCustomer = (customer: Customer) =>
    setStore((prev) => ({ ...prev, customers: [customer, ...prev.customers] }));

  const addExpense = (expense: Expense) =>
    setStore((prev) => ({ ...prev, expenses: [expense, ...prev.expenses] }));

  const addVendor = (vendor: Vendor) =>
    setStore((prev) => ({ ...prev, vendors: [vendor, ...prev.vendors] }));

  const resetDemoData = () =>
    setStore({
      customers: seedCustomers,
      vendors: seedVendors,
      invoices: seedInvoices,
      expenses: seedExpenses,
      accounts: seedAccounts,
      transactions: seedTransactions,
    });

  return (
    <DataContext.Provider
      value={{ ...store, addInvoice, updateInvoice, addCustomer, addExpense, addVendor, resetDemoData }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
