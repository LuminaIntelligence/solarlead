"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard,
  Users,
  Database,
  Settings,
  ArrowLeft,
  SendHorizonal,
  MessageSquare,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Übersicht", href: "/admin", icon: LayoutDashboard },
  { label: "Nutzerverwaltung", href: "/admin/users", icon: Users },
  { label: "Alle Leads", href: "/admin/leads", icon: Database },
  { label: "Lead-Entdeckung", href: "/admin/discovery", icon: Radar },
  { label: "Massenversand", href: "/admin/outreach", icon: SendHorizonal },
  { label: "Antworten", href: "/admin/outreach/replies", icon: MessageSquare },
  { label: "System-Einstellungen", href: "/admin/settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col text-white" style={{ backgroundColor: "#1F3D2E" }}>
      {/* Logo */}
      <div className="flex h-20 flex-col justify-center border-b px-5 gap-1" style={{ borderColor: "rgba(178,208,130,0.2)" }}>
        <Image
          src="/images/greenscout-logo-white.png"
          alt="GreenScout e.V."
          width={170}
          height={38}
          className="object-contain"
          priority
        />
        <span className="text-xs font-medium px-0.5" style={{ color: "#B2D082" }}>
          Admin-Bereich
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : item.href === "/admin/outreach/replies"
              ? pathname === "/admin/outreach/replies"
              : item.href === "/admin/outreach"
              ? pathname === "/admin/outreach" || (pathname.startsWith("/admin/outreach/") && !pathname.startsWith("/admin/outreach/replies"))
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

        {/* Separator */}
        <div className="my-3 border-t" style={{ borderColor: "rgba(178,208,130,0.2)" }} />

        {/* Back to dashboard */}
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-white/70 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Zurück zum Dashboard
        </Link>
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
