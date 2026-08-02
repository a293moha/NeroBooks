import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account, Customer, Expense, ExpenseCategory, Invoice, InvoiceStatus, Transaction, Vendor } from "../types";
import { seedAccounts, seedTransactions } from "../lib/seed";
import { useCompany } from "./CompanyContext";
import { useApiClient, ApiError } from "../lib/apiClient";

const PAYMENT_METHOD_TO_BACKEND: Record<string, string> = {
  "Credit Card": "credit_card",
  "Debit Card": "debit_card",
  "Bank Transfer": "bank_transfer",
  Cash: "cash",
  Check: "check",
};
const PAYMENT_METHOD_FROM_BACKEND: Record<string, string> = {
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  check: "Check",
  other: "Other",
};

interface CustomerRow {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
}
interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  category: string | null;
}
interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_id: string;
  issue_date: string;
  due_date: string;
  status: string;
  currency: string;
  total: string;
  amount_paid: string;
}
interface ExpenseRow {
  id: string;
  date: string;
  vendor_id: string | null;
  category: string;
  amount: string;
  payment_method: string;
  memo: string | null;
  status: string;
}

export interface NewCustomerInput {
  name: string;
  company?: string;
  email: string;
  phone?: string;
}
export interface NewVendorInput {
  name: string;
  email: string;
  category: string;
}
export interface NewExpenseInput {
  date: string;
  vendorId: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: string;
  memo?: string;
}
export interface NewInvoiceInput {
  customerId: string;
  issueDate: string;
  dueDate: string;
  status: "draft" | "sent";
  lineItems: { description: string; qty: number; rate: number }[];
  currency?: string;
  notes?: string;
}

interface StoreShape {
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  expenses: Expense[];
  accounts: Account[];
  transactions: Transaction[];
}

interface DataContextValue extends StoreShape {
  isLoading: boolean;
  error: string | null;
  addInvoice: (input: NewInvoiceInput) => Promise<void>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<void>;
  addCustomer: (input: NewCustomerInput) => Promise<void>;
  addExpense: (input: NewExpenseInput) => Promise<void>;
  addVendor: (input: NewVendorInput) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * customers/vendors/invoices/expenses are real, company-scoped data from
 * the Railway API — Neon through that API is the only source of truth,
 * never localStorage (see docs/backend-roadmap.md; the old
 * localStorage-backed version of this file is gone, not just unused).
 * accounts/transactions (chart of accounts / general ledger) remain
 * seed-only: no backend CRUD exists for them yet, which is out of scope
 * for the customers/invoices/expenses migration this file is part of.
 *
 * "balance" on a customer/vendor isn't a stored column anywhere — it's
 * derived here from the same invoices/expenses this provider already
 * fetches (outstanding invoice total per customer; pending expense total
 * per vendor), the same way the old seed data represented it, just
 * computed from real records instead of hardcoded.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { companyId } = useCompany();
  const api = useApiClient();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!companyId) {
      setCustomers([]);
      setVendors([]);
      setInvoices([]);
      setExpenses([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [customerRows, vendorRows, invoiceRows, expenseRows] = await Promise.all([
        api.get<CustomerRow[]>(`/api/companies/${companyId}/customers`),
        api.get<VendorRow[]>(`/api/companies/${companyId}/vendors`),
        api.get<InvoiceRow[]>(`/api/companies/${companyId}/invoices`),
        api.get<ExpenseRow[]>(`/api/companies/${companyId}/expenses`),
      ]);

      const outstandingByCustomer = new Map<string, number>();
      const mappedInvoices: Invoice[] = invoiceRows.map((row) => {
        const total = Number(row.total);
        const amountPaid = Number(row.amount_paid);
        if (row.status !== "paid" && row.status !== "void") {
          outstandingByCustomer.set(row.customer_id, (outstandingByCustomer.get(row.customer_id) ?? 0) + (total - amountPaid));
        }
        return {
          id: row.id,
          number: row.invoice_number,
          customerId: row.customer_id,
          issueDate: row.issue_date,
          dueDate: row.due_date,
          status: row.status as InvoiceStatus,
          total,
          lineItems: [],
          currency: row.currency,
        };
      });

      const pendingByVendor = new Map<string, number>();
      const mappedExpenses: Expense[] = expenseRows.map((row) => {
        const amount = Number(row.amount);
        if (row.vendor_id && row.status === "pending") {
          pendingByVendor.set(row.vendor_id, (pendingByVendor.get(row.vendor_id) ?? 0) + amount);
        }
        return {
          id: row.id,
          date: row.date,
          vendorId: row.vendor_id ?? "",
          category: row.category as ExpenseCategory,
          amount,
          memo: row.memo ?? undefined,
          paymentMethod: PAYMENT_METHOD_FROM_BACKEND[row.payment_method] ?? row.payment_method,
        };
      });

      setCustomers(
        customerRows.map((row) => ({
          id: row.id,
          name: row.name,
          company: row.company_name ?? undefined,
          email: row.email ?? "",
          phone: row.phone ?? undefined,
          balance: outstandingByCustomer.get(row.id) ?? 0,
        }))
      );
      setVendors(
        vendorRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email ?? "",
          category: row.category ?? "Other",
          balance: pendingByVendor.get(row.id) ?? 0,
        }))
      );
      setInvoices(mappedInvoices);
      setExpenses(mappedExpenses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your data. Please try again.");
    } finally {
      setIsLoading(false);
    }
    // api's `get` is a fresh closure each render but always calls into the
    // same stable, token-aware request function underneath — re-running
    // this effect only on companyId change (not on every render) is what
    // we actually want here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addCustomer = async (input: NewCustomerInput) => {
    await api.post(`/api/companies/${companyId}/customers`, {
      name: input.name,
      companyName: input.company,
      email: input.email,
      phone: input.phone,
    });
    await refetch();
  };

  const addVendor = async (input: NewVendorInput) => {
    await api.post(`/api/companies/${companyId}/vendors`, {
      name: input.name,
      email: input.email,
      category: input.category,
    });
    await refetch();
  };

  const addExpense = async (input: NewExpenseInput) => {
    await api.post(`/api/companies/${companyId}/expenses`, {
      date: input.date,
      vendorId: input.vendorId || undefined,
      category: input.category,
      amount: input.amount,
      paymentMethod: PAYMENT_METHOD_TO_BACKEND[input.paymentMethod] ?? "credit_card",
      memo: input.memo,
    });
    await refetch();
  };

  const addInvoice = async (input: NewInvoiceInput) => {
    await api.post(`/api/companies/${companyId}/invoices`, {
      customerId: input.customerId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      lineItems: input.lineItems.map((li) => ({ description: li.description, quantity: li.qty, unitPrice: li.rate })),
      currency: input.currency,
      notes: input.notes,
    });
    await refetch();
  };

  const updateInvoiceStatus = async (id: string, status: InvoiceStatus) => {
    await api.patch(`/api/companies/${companyId}/invoices/${id}/status`, { status });
    await refetch();
  };

  return (
    <DataContext.Provider
      value={{
        customers,
        vendors,
        invoices,
        expenses,
        accounts: seedAccounts,
        transactions: seedTransactions,
        isLoading,
        error,
        addInvoice,
        updateInvoiceStatus,
        addCustomer,
        addExpense,
        addVendor,
      }}
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
