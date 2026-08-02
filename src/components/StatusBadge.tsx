import type { InvoiceStatus } from "../types";

const labels: Record<InvoiceStatus, string> = {
  paid: "Paid",
  sent: "Sent",
  draft: "Draft",
  overdue: "Overdue",
  partially_paid: "Partially paid",
  void: "Void",
};

// partially_paid and void have no dedicated CSS treatment (existing
// design only styled the original four statuses) — visually grouped with
// the closest existing look rather than inventing new badge colors.
const styleClass: Record<InvoiceStatus, string> = {
  paid: "paid",
  sent: "sent",
  draft: "draft",
  overdue: "overdue",
  partially_paid: "sent",
  void: "draft",
};

export default function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`badge ${styleClass[status]}`}>
      <span className="badge-dot" />
      {labels[status]}
    </span>
  );
}
