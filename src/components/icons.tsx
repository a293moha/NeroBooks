import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      {...props}
    />
  );
}

export const DashboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const InvoiceIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M9 9h6M9 13h6M9 17h4" />
  </Icon>
);

export const CustomersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <circle cx="17.5" cy="9" r="2.4" />
    <path d="M15.8 14.6c2.4.2 4.2 1.9 4.2 4.9" />
  </Icon>
);

export const ExpensesIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="13" rx="2" />
    <path d="M2.5 10h19" />
    <circle cx="7" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

export const VendorsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M4 9h16v10H4z" />
    <path d="M9 13v6M15 13v6" />
  </Icon>
);

export const AccountsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V10M9 21V10M15 21V10M19 21V10" />
    <path d="M3 10l9-6 9 6" />
  </Icon>
);

export const TransactionsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h13l-3-3M20 17H7l3 3" />
  </Icon>
);

export const ReportsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="M8 15l3-4 3 2.5 4-6" />
  </Icon>
);

export const TeamIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="3" />
    <circle cx="16" cy="8" r="3" />
    <path d="M2 20c0-3 2.5-5 6-5s6 2 6 5" />
    <path d="M13.5 15c3 .3 4.5 2.2 4.5 5" />
  </Icon>
);

export const BillingIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M2.5 10h19" />
    <path d="M6 15h5" />
  </Icon>
);

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const EditIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z" />
    <path d="M13.5 6.5l3 3" />
  </Icon>
);

export const HistoryIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
);
