"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, AlertTriangle, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface FollowUpLead {
  id: string;
  company_name: string;
  city: string | null;
  category: string | null;
  next_contact_date: string;
  total_score: number;
}

interface FollowUpData {
  today: FollowUpLead[];
  overdue: FollowUpLead[];
}

const TOAST_KEY = "solarlead:followup-toast-shown";

export function FollowUpReminder() {
  const [data, setData] = useState<FollowUpData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/leads/follow-ups")
      .then((r) => r.json())
      .then((d: FollowUpData) => {
        setData(d);
        // Toast einmal pro Tag anzeigen wenn fällige Wiedervorlagen vorhanden
        const today = new Date().toISOString().slice(0, 10);
        const total = (d.today?.length ?? 0) + (d.overdue?.length ?? 0);
        try {
          const last = window.sessionStorage.getItem(TOAST_KEY);
          if (total > 0 && last !== today) {
            toast({
              title: `${total} Wiedervorlage${total === 1 ? "" : "n"} fällig`,
              description:
                d.overdue?.length > 0
                  ? `${d.overdue.length} überfällig · ${d.today?.length ?? 0} heute`
                  : `Heute solltest du dich bei ${total} Lead${total === 1 ? "" : "s"} melden.`,
            });
            window.sessionStorage.setItem(TOAST_KEY, today);
          }
        } catch {
          // sessionStorage not available — silently skip toast tracking
        }
      })
      .catch(() => setData({ today: [], overdue: [] }))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return null;
  const total = (data?.today?.length ?? 0) + (data?.overdue?.length ?? 0);
  if (total === 0) return null;

  return (
    <div className="rounded-xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-orange-500 text-white flex items-center justify-center">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-900">
            Wiedervorlagen heute fällig
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {data!.overdue.length > 0 && (
              <span className="text-red-700 font-medium">
                {data!.overdue.length} überfällig
              </span>
            )}
            {data!.overdue.length > 0 && data!.today.length > 0 && " · "}
            {data!.today.length > 0 && (
              <span>{data!.today.length} heute</span>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {data!.overdue.map((lead) => (
          <FollowUpRow key={lead.id} lead={lead} overdue />
        ))}
        {data!.today.map((lead) => (
          <FollowUpRow key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}

function FollowUpRow({
  lead,
  overdue = false,
}: {
  lead: FollowUpLead;
  overdue?: boolean;
}) {
  const date = new Date(lead.next_contact_date).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <Link
      href={`/dashboard/leads/${lead.id}`}
      className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 hover:bg-slate-50 border border-slate-100 group"
    >
      {overdue ? (
        <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
      ) : (
        <CalendarClock className="h-4 w-4 text-orange-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">
          {lead.company_name}
        </div>
        {lead.city && (
          <div className="text-xs text-slate-500 truncate">{lead.city}</div>
        )}
      </div>
      <div
        className={`text-xs font-semibold whitespace-nowrap ${
          overdue ? "text-red-600" : "text-orange-600"
        }`}
      >
        {date}
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
    </Link>
  );
}
