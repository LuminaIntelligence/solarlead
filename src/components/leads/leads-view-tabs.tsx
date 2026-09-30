"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Clock, List } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tabs oberhalb der Leads-Tabelle:
 *  - "Alle Leads" (default, view!=recent)
 *  - "Zuletzt bearbeitet" (view=recent → getLeads sortiert nach updated_at DESC)
 *
 * Filter/PLZ/Score bleiben aktiv, nur die Sortierung wird im recent-Modus
 * überschrieben.
 */
export function LeadsViewTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "all";

  const switchTo = useCallback(
    (nextView: "all" | "recent") => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextView === "recent") {
        params.set("view", "recent");
      } else {
        params.delete("view");
      }
      router.push(`/dashboard/leads?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex items-center gap-1 border-b">
      <TabButton
        active={view !== "recent"}
        onClick={() => switchTo("all")}
        icon={<List className="h-4 w-4" />}
        label="Alle Leads"
      />
      <TabButton
        active={view === "recent"}
        onClick={() => switchTo("recent")}
        icon={<Clock className="h-4 w-4" />}
        label="Zuletzt bearbeitet"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-slate-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
