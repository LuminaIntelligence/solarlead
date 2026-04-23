"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  Search,
  MapPin,
  Map,
  Users,
  FileUp,
  Settings,
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
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col text-white" style={{ backgroundColor: "#1F3D2E" }}>
      {/* Logo */}
      <div className="flex h-20 items-center border-b px-5" style={{ borderColor: "rgba(178,208,130,0.2)" }}>
        <Image
          src="/images/greenscout-logo-white.png"
          alt="GreenScout e.V."
          width={180}
          height={40}
          className="object-contain"
          priority
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
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
                  ? "text-[#1F3D2E] font-semibold"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              )}
              style={isActive ? { backgroundColor: "#B2D082" } : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {/* Admin link */}
        {isAdmin && (
          <>
            <div className="my-3 border-t" style={{ borderColor: "rgba(178,208,130,0.2)" }} />
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin")
                  ? "text-[#1F3D2E] font-semibold"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              )}
              style={pathname.startsWith("/admin") ? { backgroundColor: "#B2D082" } : undefined}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin-Bereich
            </Link>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t px-5 py-4" style={{ borderColor: "rgba(178,208,130,0.2)" }}>
        <p className="text-xs" style={{ color: "rgba(178,208,130,0.6)" }}>
          Powered by SolarLead AI &copy; {new Date().getFullYear()}
        </p>
      </div>
    </aside>
  );
}
