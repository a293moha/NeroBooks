import type { Invoice } from "../types";

export function currency(amount: number, currencyCode: string = "USD"): string {
  try {
    return amount.toLocaleString("en-US", { style: "currency", currency: currencyCode });
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

export function invoiceTotal(invoice: Invoice): number {
  return invoice.total;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
