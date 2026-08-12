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

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentAccountId: string | null;
  isActive: boolean;
  /** True when a bank_accounts row links this account as a real cash/bank account — used by Reports to compute ending cash without guessing from code/name. */
  isCashAccount: boolean;
  /** True when any journal entry line (draft or posted) references this account — drives Delete-vs-Deactivate in the UI. */
  hasActivity: boolean;
  /** Server-computed from posted journal entry lines only, sign-flipped by type so every account's balance reads as a natural positive number. Never client-settable. */
  balance: number;
}

export type JournalEntryStatus = "draft" | "posted" | "void";

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  entryDate: string;
  reference?: string;
  description?: string;
  status: JournalEntryStatus;
  postedAt?: string | null;
  lines: JournalEntryLine[];
}
