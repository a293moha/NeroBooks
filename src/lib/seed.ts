import type {
  Account,
  Customer,
  Expense,
  Invoice,
  Transaction,
  Vendor,
} from "../types";

export const seedCustomers: Customer[] = [
  { id: "c1", name: "Alex Morgan", email: "alex@brightleaf.com", company: "Brightleaf Design", balance: 2400 },
  { id: "c2", name: "Priya Nair", email: "priya@fernwood.io", company: "Fernwood Studio", balance: 0 },
  { id: "c3", name: "Sam Whitfield", email: "sam@harbormark.co", company: "Harbormark Co.", balance: 980 },
  { id: "c4", name: "Jordan Lee", email: "jordan@northpeak.com", company: "Northpeak Consulting", balance: 5200 },
];

export const seedVendors: Vendor[] = [
  { id: "v1", name: "CloudBase Hosting", email: "billing@cloudbase.com", category: "Software", balance: 129 },
  { id: "v2", name: "OfficeMart", email: "orders@officemart.com", category: "Office Supplies", balance: 0 },
  { id: "v3", name: "Metro Power & Light", email: "billing@metropower.com", category: "Utilities", balance: 210 },
  { id: "v4", name: "SwiftCourier", email: "support@swiftcourier.com", category: "Travel", balance: 45 },
];

export const seedInvoices: Invoice[] = [
  {
    id: "i1",
    number: "INV-1001",
    customerId: "c1",
    issueDate: "2026-06-15",
    dueDate: "2026-07-15",
    status: "overdue",
    lineItems: [{ id: "li1", description: "Brand identity package", qty: 1, rate: 2400 }],
  },
  {
    id: "i2",
    number: "INV-1002",
    customerId: "c2",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    status: "paid",
    lineItems: [{ id: "li2", description: "Website redesign", qty: 1, rate: 3600 }],
  },
  {
    id: "i3",
    number: "INV-1003",
    customerId: "c3",
    issueDate: "2026-07-05",
    dueDate: "2026-08-04",
    status: "sent",
    lineItems: [{ id: "li3", description: "Consulting hours", qty: 14, rate: 70 }],
  },
  {
    id: "i4",
    number: "INV-1004",
    customerId: "c4",
    issueDate: "2026-07-10",
    dueDate: "2026-08-09",
    status: "sent",
    lineItems: [
      { id: "li4a", description: "Strategy workshop", qty: 1, rate: 3200 },
      { id: "li4b", description: "Follow-up sessions", qty: 4, rate: 500 },
    ],
  },
  {
    id: "i5",
    number: "INV-1005",
    customerId: "c1",
    issueDate: "2026-07-18",
    dueDate: "2026-08-17",
    status: "draft",
    lineItems: [{ id: "li5", description: "Logo refresh", qty: 1, rate: 800 }],
  },
];

export const seedExpenses: Expense[] = [
  { id: "e1", date: "2026-07-01", vendorId: "v1", category: "Software", amount: 129, paymentMethod: "Credit Card" },
  { id: "e2", date: "2026-07-03", vendorId: "v3", category: "Utilities", amount: 210, paymentMethod: "Bank Transfer" },
  { id: "e3", date: "2026-07-08", vendorId: "v4", category: "Travel", amount: 45, paymentMethod: "Credit Card" },
  { id: "e4", date: "2026-07-11", vendorId: "v2", category: "Office Supplies", amount: 88, paymentMethod: "Debit Card" },
  { id: "e5", date: "2026-06-20", vendorId: "v1", category: "Software", amount: 129, paymentMethod: "Credit Card" },
  { id: "e6", date: "2026-06-18", vendorId: "v3", category: "Utilities", amount: 195, paymentMethod: "Bank Transfer" },
];

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
