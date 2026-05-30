"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthControl } from "@/components/AuthControl";

const TABS = [
  { href: "/", label: "Monitor" },
  { href: "/console", label: "Console" },
  { href: "/desk", label: "Desk" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <span className="nav-brand">≣ SEVE</span>
      {TABS.map((t) => {
        const active =
          t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""}>
            {t.label}
          </Link>
        );
      })}
      <span className="nav-spacer" />
      <AuthControl />
    </nav>
  );
}
