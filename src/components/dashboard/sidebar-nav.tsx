"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Search,
  MapPin,
  Map,
  Users,
  FileUp,
  Settings,
  Sun,
  Shield,
  Kanban,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Lead-Suche", href: "/dashboard/search", icon: Search },
  { label: "Adresssuche", href: "/dashboard/address-search", icon: MapPin },
  { label: "Alle Leads", href: "/dashboard/leads", icon: Users },
  { label: "Pipeline", href: "/dashboard/pipeline", icon: Kanban },
  { label: "Wiedervorlage", href: "/dashboard/followup", icon: Bell },
  { label: "Karte", href: "/dashboard/map", icon: Map },
  { label: "Import/Export", href: "/dashboard/import", icon: FileUp },
  { label: "Einstellungen", href: "/dashboard/settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.role === "admin") {
        setIsAdmin(true);
      }
    }
    checkAdmin();
  }, []);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900 text-slate-300">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-6">
        <Sun className="h-6 w-6 text-green-500" />
        <span className="text-lg font-semibold tracking-tight text-white">
          SolarLead AI
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-green-600/20 text-green-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {/* Admin link */}
        {isAdmin && (
          <>
            <div className="my-2 border-t border-slate-800" />
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin")
                  ? "bg-red-600/20 text-red-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin-Bereich
            </Link>
          </>
        )}
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
