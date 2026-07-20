export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

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
  lineItems: InvoiceLineItem[];
  notes?: string;
  /** Pro-only: per-invoice currency override. Absent = account default currency. */
  currency?: string;
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

export interface Expense {
  id: string;
  date: string;
  vendorId: string;
  category: ExpenseCategory;
  amount: number;
  memo?: string;
  paymentMethod: string;
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
