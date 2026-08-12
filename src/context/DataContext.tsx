import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type {
  Account,
  AccountType,
  Customer,
  Expense,
  ExpenseCategory,
  ExpenseHistoryEntry,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  JournalEntry,
  JournalEntryStatus,
  Vendor,
} from "../types";
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
  last_edited_at: string | null;
}
interface InvoiceItemRow {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
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
interface AccountRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  parent_account_id: string | null;
  is_active: boolean;
  is_cash_account: boolean;
  has_activity: boolean;
  balance: string;
}
interface JournalEntryLineRow {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  description: string | null;
}
interface JournalEntryRow {
  id: string;
  entry_date: string;
  reference: string | null;
  description: string | null;
  status: string;
  posted_at: string | null;
  lines: JournalEntryLineRow[];
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
export interface EditInvoiceInput {
  customerId: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  lineItems: { description: string; qty: number; rate: number }[];
  currency?: string;
}
export interface EditExpenseInput {
  date: string;
  vendorId: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: string;
  memo?: string;
}
export interface NewAccountInput {
  code: string;
  name: string;
  type: AccountType;
  parentAccountId?: string;
}
export interface EditAccountInput {
  code: string;
  name: string;
  type: AccountType;
  parentAccountId?: string | null;
  isActive: boolean;
}
export interface JournalLineFormInput {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}
export interface NewJournalEntryInput {
  entryDate: string;
  reference?: string;
  description?: string;
  lines: JournalLineFormInput[];
  post?: boolean;
}
export interface EditJournalEntryInput {
  entryDate: string;
  reference?: string;
  description?: string;
  lines: JournalLineFormInput[];
}

interface StoreShape {
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  expenses: Expense[];
  accounts: Account[];
  journalEntries: JournalEntry[];
}

interface DataContextValue extends StoreShape {
  isLoading: boolean;
  error: string | null;
  addInvoice: (input: NewInvoiceInput) => Promise<void>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<void>;
  updateInvoice: (id: string, input: EditInvoiceInput) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  fetchInvoiceItems: (id: string) => Promise<InvoiceLineItem[]>;
  addCustomer: (input: NewCustomerInput) => Promise<void>;
  addExpense: (input: NewExpenseInput) => Promise<void>;
  updateExpense: (id: string, input: EditExpenseInput) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  fetchExpenseHistory: (id: string) => Promise<ExpenseHistoryEntry[]>;
  addVendor: (input: NewVendorInput) => Promise<void>;
  addAccount: (input: NewAccountInput) => Promise<void>;
  updateAccount: (id: string, input: EditAccountInput) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  addJournalEntry: (input: NewJournalEntryInput) => Promise<void>;
  updateJournalEntry: (id: string, input: EditJournalEntryInput) => Promise<void>;
  postJournalEntry: (id: string) => Promise<void>;
  deleteJournalEntry: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Every resource here is real, company-scoped data from the Railway API —
 * Neon through that API is the only source of truth, never localStorage
 * (see docs/backend-roadmap.md; the old localStorage-backed version of
 * this file is gone, not just unused). accounts/journalEntries (chart of
 * accounts / general ledger) became real as of Phase 1 of the QuickBooks-
 * parity roadmap — previously seed-only, see git history for the old
 * src/lib/seed.ts this replaced.
 *
 * "balance" on a customer/vendor isn't a stored column anywhere — it's
 * derived here from the same invoices/expenses this provider already
 * fetches (outstanding invoice total per customer; pending expense total
 * per vendor). "balance" on an Account *is* a stored-looking field on the
 * type, but is entirely server-computed from posted journal entry lines
 * (see accounting.routes.ts) — never client-set, never derived here.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { companyId } = useCompany();
  const api = useApiClient();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapJournalLine = (line: JournalEntryLineRow) => ({
    id: line.id,
    accountId: line.account_id,
    accountCode: line.account_code,
    accountName: line.account_name,
    debit: Number(line.debit),
    credit: Number(line.credit),
    description: line.description ?? undefined,
  });

  const refetch = useCallback(async () => {
    if (!companyId) {
      setCustomers([]);
      setVendors([]);
      setInvoices([]);
      setExpenses([]);
      setAccounts([]);
      setJournalEntries([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [customerRows, vendorRows, invoiceRows, expenseRows, accountRows, journalEntryRows] = await Promise.all([
        api.get<CustomerRow[]>(`/api/companies/${companyId}/customers`),
        api.get<VendorRow[]>(`/api/companies/${companyId}/vendors`),
        api.get<InvoiceRow[]>(`/api/companies/${companyId}/invoices`),
        api.get<ExpenseRow[]>(`/api/companies/${companyId}/expenses`),
        api.get<AccountRow[]>(`/api/companies/${companyId}/accounts`),
        api.get<JournalEntryRow[]>(`/api/companies/${companyId}/journal-entries`),
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
          lastEditedAt: row.last_edited_at,
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
          status: row.status as Expense["status"],
        };
      });

      const mappedAccounts: Account[] = accountRows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.account_type as AccountType,
        parentAccountId: row.parent_account_id,
        isActive: row.is_active,
        isCashAccount: row.is_cash_account,
        hasActivity: row.has_activity,
        balance: Number(row.balance),
      }));

      const mappedJournalEntries: JournalEntry[] = journalEntryRows.map((row) => ({
        id: row.id,
        entryDate: row.entry_date,
        reference: row.reference ?? undefined,
        description: row.description ?? undefined,
        status: row.status as JournalEntryStatus,
        postedAt: row.posted_at,
        lines: row.lines.map(mapJournalLine),
      }));

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
      setAccounts(mappedAccounts);
      setJournalEntries(mappedJournalEntries);
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

  const updateInvoice = async (id: string, input: EditInvoiceInput) => {
    await api.patch(`/api/companies/${companyId}/invoices/${id}`, {
      customerId: input.customerId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      lineItems: input.lineItems.map((li) => ({ description: li.description, quantity: li.qty, unitPrice: li.rate })),
      currency: input.currency,
    });
    await refetch();
  };

  const fetchInvoiceItems = async (id: string): Promise<InvoiceLineItem[]> => {
    const items = await api.get<InvoiceItemRow[]>(`/api/companies/${companyId}/invoices/${id}/items`);
    return items.map((item) => ({
      id: item.id,
      description: item.description,
      qty: Number(item.quantity),
      rate: Number(item.unit_price),
    }));
  };

  const updateExpense = async (id: string, input: EditExpenseInput) => {
    await api.patch(`/api/companies/${companyId}/expenses/${id}`, {
      date: input.date,
      vendorId: input.vendorId || undefined,
      category: input.category,
      amount: input.amount,
      paymentMethod: PAYMENT_METHOD_TO_BACKEND[input.paymentMethod] ?? "credit_card",
      memo: input.memo,
    });
    await refetch();
  };

  const fetchExpenseHistory = (id: string) => api.get<ExpenseHistoryEntry[]>(`/api/companies/${companyId}/expenses/${id}/history`);

  const deleteInvoice = async (id: string) => {
    await api.del(`/api/companies/${companyId}/invoices/${id}`);
    await refetch();
  };

  const deleteExpense = async (id: string) => {
    await api.del(`/api/companies/${companyId}/expenses/${id}`);
    await refetch();
  };

  const addAccount = async (input: NewAccountInput) => {
    await api.post(`/api/companies/${companyId}/accounts`, {
      code: input.code,
      name: input.name,
      accountType: input.type,
      parentAccountId: input.parentAccountId || undefined,
    });
    await refetch();
  };

  const updateAccount = async (id: string, input: EditAccountInput) => {
    await api.patch(`/api/companies/${companyId}/accounts/${id}`, {
      code: input.code,
      name: input.name,
      accountType: input.type,
      parentAccountId: input.parentAccountId ?? null,
      isActive: input.isActive,
    });
    await refetch();
  };

  const deleteAccount = async (id: string) => {
    await api.del(`/api/companies/${companyId}/accounts/${id}`);
    await refetch();
  };

  const addJournalEntry = async (input: NewJournalEntryInput) => {
    await api.post(`/api/companies/${companyId}/journal-entries`, {
      entryDate: input.entryDate,
      reference: input.reference,
      description: input.description,
      lines: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })),
      post: input.post ?? false,
    });
    await refetch();
  };

  const updateJournalEntry = async (id: string, input: EditJournalEntryInput) => {
    await api.patch(`/api/companies/${companyId}/journal-entries/${id}`, {
      entryDate: input.entryDate,
      reference: input.reference,
      description: input.description,
      lines: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })),
    });
    await refetch();
  };

  const postJournalEntry = async (id: string) => {
    await api.post(`/api/companies/${companyId}/journal-entries/${id}/post`);
    await refetch();
  };

  const deleteJournalEntry = async (id: string) => {
    await api.del(`/api/companies/${companyId}/journal-entries/${id}`);
    await refetch();
  };

  return (
    <DataContext.Provider
      value={{
        customers,
        vendors,
        invoices,
        expenses,
        accounts,
        journalEntries,
        isLoading,
        error,
        addInvoice,
        updateInvoiceStatus,
        updateInvoice,
        deleteInvoice,
        fetchInvoiceItems,
        addCustomer,
        addExpense,
        updateExpense,
        deleteExpense,
        fetchExpenseHistory,
        addVendor,
        addAccount,
        updateAccount,
        deleteAccount,
        addJournalEntry,
        updateJournalEntry,
        postJournalEntry,
        deleteJournalEntry,
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
