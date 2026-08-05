export type InvoiceStatus = "draft" | "sent" | "paid" | "partially_paid" | "overdue" | "void";

export interface InvoiceLineItem {
  id: string;
  description: string;
  qty: number;
  rate: number;
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  /** Populated by the server (subtotal + tax, before amount_paid) — the source of truth for display; never recomputed client-side from lineItems. */
  total: number;
  /** Only populated when explicitly fetched (invoice detail); empty for list rows. */
  lineItems: InvoiceLineItem[];
  notes?: string;
  /** Plus/Advanced only: per-invoice currency override. Absent = account default currency. */
  currency?: string;
  /**
   * Plus/Advanced only: flags the invoice to recur. UI toggle only — there
   * is no backend column or auto-rebilling engine behind this yet, so it
   * is never persisted and will not survive a refetch.
   */
  recurring?: boolean;
  /** Set only by the edit form (never by status transitions/payments) — when this invoice's content was last changed after issuing. */
  lastEditedAt?: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  balance: number;
}

export interface Vendor {
  id: string;
  name: string;
  email: string;
  category: string;
  balance: number;
}

export type ExpenseCategory =
  | "Advertising"
  | "Office Supplies"
  | "Travel"
  | "Utilities"
  | "Rent"
  | "Software"
  | "Payroll"
  | "Insurance"
  | "Other";

export type ExpenseStatus = "pending" | "approved" | "reimbursed" | "rejected";

export interface Expense {
  id: string;
  date: string;
  vendorId: string;
  category: ExpenseCategory;
  amount: number;
  memo?: string;
  paymentMethod: string;
  status: ExpenseStatus;
}

export interface ExpenseHistoryChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

export interface ExpenseHistoryEntry {
  id: string;
  action: string;
  createdAt: string;
  changes: ExpenseHistoryChange[];
}

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  balance: number;
}

export interface Transaction {
  id: string;
  date: string;
  accountId: string;
  description: string;
  debit: number;
  credit: number;
}
