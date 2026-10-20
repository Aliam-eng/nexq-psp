"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Deposit | Withdraw switch in the public header.
export function PublicTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/deposit", label: "Deposit" },
    { href: "/withdraw", label: "Withdraw" },
  ];
  return (
    <nav className="flex rounded-full bg-white/10 p-1 text-[13px] font-semibold">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-full px-4 py-1.5 transition ${active ? "bg-white text-charcoal" : "text-white/75 hover:text-white"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
