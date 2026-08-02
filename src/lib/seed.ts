import type { Account, Transaction } from "../types";

// Customers/vendors/invoices/expenses used to be seeded here too, but that
// was fake data standing in for a real backend -- see DataContext.tsx,
// which now fetches all four from the Railway API. accounts/transactions
// remain seed-only below: no chart-of-accounts/general-ledger backend
// exists yet, so there's nothing real to fetch for these two.

export const seedAccounts: Account[] = [
  { id: "a1", code: "1000", name: "Business Checking", type: "Asset", balance: 18420 },
  { id: "a2", code: "1010", name: "Accounts Receivable", type: "Asset", balance: 8580 },
  { id: "a3", code: "2000", name: "Accounts Payable", type: "Liability", balance: 384 },
  { id: "a4", code: "3000", name: "Owner's Equity", type: "Equity", balance: 15000 },
  { id: "a5", code: "4000", name: "Service Income", type: "Income", balance: 22300 },
  { id: "a6", code: "5000", name: "Operating Expenses", type: "Expense", balance: 5940 },
];

export const seedTransactions: Transaction[] = [
  { id: "t1", date: "2026-07-01", accountId: "a5", description: "Invoice INV-1002 payment", debit: 0, credit: 3600 },
  { id: "t2", date: "2026-07-01", accountId: "a1", description: "Invoice INV-1002 payment", debit: 3600, credit: 0 },
  { id: "t3", date: "2026-07-01", accountId: "a6", description: "CloudBase Hosting", debit: 129, credit: 0 },
  { id: "t4", date: "2026-07-03", accountId: "a6", description: "Metro Power & Light", debit: 210, credit: 0 },
  { id: "t5", date: "2026-07-08", accountId: "a6", description: "SwiftCourier", debit: 45, credit: 0 },
  { id: "t6", date: "2026-07-11", accountId: "a6", description: "OfficeMart", debit: 88, credit: 0 },
];
