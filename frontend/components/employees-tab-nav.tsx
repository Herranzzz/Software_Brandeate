"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";


const TABS = [
  { href: "/employees", label: "Empleados" },
  { href: "/employees/print-queue", label: "Cola de impresión" },
];

export function EmployeesTabNav() {
  const pathname = usePathname();

  return (
    <nav className="employees-tab-nav" aria-label="Sección de equipo">
      {TABS.map((tab) => {
        const active =
          tab.href === "/employees"
            ? pathname === "/employees"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`employees-tab-nav-item ${active ? "employees-tab-nav-item-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
