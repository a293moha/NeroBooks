import type { InvoiceStatus } from "../types";

const labels: Record<InvoiceStatus, string> = {
  paid: "Paid",
  sent: "Sent",
  draft: "Draft",
  overdue: "Overdue",
};

export default function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className="badge-dot" />
      {labels[status]}
    </span>
  );
}
