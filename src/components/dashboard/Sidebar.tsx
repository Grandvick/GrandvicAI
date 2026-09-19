"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./nav";

export function Sidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 md:flex">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
          G
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Grandvic AI</p>
          <p className="truncate text-xs text-slate-500" title={businessName}>
            {businessName}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto">
        {navSections.map((section, i) => (
          <div key={i} className="space-y-1">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden>{item.icon}</span>
                    {item.label}
                  </span>
                  {item.comingInPhase && !active && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      Phase {item.comingInPhase}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
