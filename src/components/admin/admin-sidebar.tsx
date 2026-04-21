"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Database,
  Settings,
  Shield,
  ArrowLeft,
  SendHorizonal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Übersicht", href: "/admin", icon: LayoutDashboard },
  { label: "Nutzerverwaltung", href: "/admin/users", icon: Users },
  { label: "Alle Leads", href: "/admin/leads", icon: Database },
  { label: "Massenversand", href: "/admin/outreach", icon: SendHorizonal },
  { label: "System-Einstellungen", href: "/admin/settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-950 text-slate-300">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-6">
        <Shield className="h-6 w-6 text-red-500" />
        <span className="text-lg font-semibold tracking-tight text-white">
          SolarLead AI
        </span>
        <span className="ml-auto rounded bg-red-600/20 px-2 py-0.5 text-xs font-medium text-red-400">
          Admin
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-red-600/20 text-red-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {/* Separator */}
        <div className="my-3 border-t border-slate-800" />

        {/* Back to dashboard */}
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Zurück zum Dashboard
        </Link>
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-6 py-4">
        <p className="text-xs text-slate-500">
          &copy; {new Date().getFullYear()} SolarLead AI
        </p>
      </div>
    </aside>
  );
}
