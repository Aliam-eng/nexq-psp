"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; short?: string; icon: string; adminOnly?: boolean }[] = [
  { href: "/admin/transactions", label: "Deposits", icon: "M12 5v14M5 12l7 7 7-7" }, // money in
  { href: "/admin/withdrawals", label: "Withdrawals", short: "Withdraw", icon: "M12 19V5M5 12l7-7 7 7" }, // money out
  {
    href: "/admin/users",
    label: "Staff",
    adminOnly: true,
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  },
  { href: "/admin/activity", label: "Activity log", short: "Log", adminOnly: true, icon: "M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9z" },
  {
    href: "/admin/settings",
    label: "Settings",
    adminOnly: true,
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  },
];

// Admin navigation — a vertical list in the desktop sidebar; on phones an evenly
// spaced icon row where every item always fits (no hidden, swipe-only tabs).
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => isAdmin || !l.adminOnly);
  const icon = (d: string, cls: string) => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  return (
    <>
      {/* Phones */}
      <nav className="grid gap-1 px-2 pb-2 md:hidden" style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}>
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition ${
                active ? "bg-white/[0.14] text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {icon(l.icon, "h-5 w-5")}
              <span className="truncate">{l.short ?? l.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Desktop sidebar */}
      <nav className="hidden flex-col gap-1 px-4 md:flex">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                active ? "bg-white/[0.12] text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {active && <span className="bg-brand-gradient absolute inset-y-2 left-0 w-1 rounded-full" />}
              {icon(l.icon, "h-[18px] w-[18px] shrink-0")}
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
