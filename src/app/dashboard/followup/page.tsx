"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, CalendarClock, Loader2, RefreshCw, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FollowupLead {
  id: string;
  company_name: string;
  category: string;
  city: string;
  total_score: number;
  status: string;
  next_contact_date: string;
  win_probability: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: "Neu", reviewed: "Geprüft", contacted: "Kontaktiert",
  qualified: "Qualifiziert", rejected: "Abgelehnt",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800", reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800", qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const CATEGORY_LABELS: Record<string, string> = {
  logistics: "Logistik", warehouse: "Lager", cold_storage: "Kühlhaus",
  supermarket: "Supermarkt", food_production: "Lebensmittelprod.",
  manufacturing: "Fertigung", metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus", hotel: "Hotel", furniture_store: "Möbelhaus",
  hardware_store: "Baumarkt", shopping_center: "Einkaufszentrum",
};

function scoreColor(score: number) {
  if (score >= 75) return "bg-green-100 text-green-800";
  if (score >= 55) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function FollowupPage() {
  const [leads, setLeads] = useState<FollowupLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [newDates, setNewDates] = useState<Record<string, string>>({});

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads/pipeline");
      const data = await res.json();
      if (Array.isArray(data)) {
        const today = todayStr();
        const nextWeek = addDays(7);
        const filtered = data
          .filter((l: FollowupLead) => l.next_contact_date && l.next_contact_date <= nextWeek && l.status !== "rejected")
          .sort((a: FollowupLead, b: FollowupLead) => a.next_contact_date.localeCompare(b.next_contact_date));
        setLeads(filtered);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function markContacted(lead: FollowupLead) {
    setActioning(lead.id);
    try {
      const newDate = newDates[lead.id] || addDays(7);
      await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "contacted", next_contact_date: newDate }),
      });
      await fetchLeads();
    } finally {
      setActioning(null);
    }
  }

  async function snooze(leadId: string, days: number) {
    setActioning(leadId);
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next_contact_date: addDays(days) }),
      });
      await fetchLeads();
    } finally {
      setActioning(null);
    }
  }

  const today = todayStr();
  const overdue = leads.filter((l) => l.next_contact_date < today);
  const dueToday = leads.filter((l) => l.next_contact_date === today);
  const upcoming = leads.filter((l) => l.next_contact_date > today);

  function Section({
    title, icon, color, items, emptyText
  }: {
    title: string;
    icon: React.ReactNode;
    color: string;
    items: FollowupLead[];
    emptyText: string;
  }) {
    return (
      <div className="space-y-3">
        <div className={cn("flex items-center gap-2 font-semibold text-sm px-3 py-2 rounded-lg", color)}>
          {icon}
          {title}
          <span className="ml-auto font-bold">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground px-3">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {items.map((lead) => (
              <div
                key={lead.id}
                className="rounded-xl border bg-white shadow-sm p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="font-semibold text-sm hover:text-green-700 hover:underline leading-tight"
                    >
                      {lead.company_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {lead.city} · {CATEGORY_LABELS[lead.category] ?? lead.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className={cn("text-xs font-bold", scoreColor(lead.total_score))}>
                      {lead.total_score}
                    </Badge>
                    <Badge variant="secondary" className={cn("text-xs", STATUS_COLORS[lead.status])}>
                      {STATUS_LABELS[lead.status]}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">Fällig: {formatDate(lead.next_contact_date)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Input
                      type="date"
                      className="h-7 text-xs w-36"
                      value={newDates[lead.id] || addDays(7)}
                      onChange={(e) => setNewDates((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                      disabled={actioning === lead.id}
                      onClick={() => markContacted(lead)}
                    >
                      {actioning === lead.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Kontaktiert
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={actioning === lead.id}
                      onClick={() => snooze(lead.id, 3)}
                    >
                      +3 Tage
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={actioning === lead.id}
                      onClick={() => snooze(lead.id, 7)}
                    >
                      +1 Woche
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6 text-green-600" />
            Wiedervorlage
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fällige Kontakte der nächsten 7 Tage
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
          <Calendar className="h-12 w-12 text-slate-300 mb-3" />
          <p className="text-lg font-medium text-muted-foreground">Keine fälligen Kontakte</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Setze bei Leads ein „Nächster Kontakt"-Datum um hier Erinnerungen zu erhalten.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section
            title="Überfällig"
            icon={<span className="text-base">🔴</span>}
            color="bg-red-50 text-red-800"
            items={overdue}
            emptyText="Keine überfälligen Kontakte."
          />
          <Section
            title="Heute fällig"
            icon={<span className="text-base">🟠</span>}
            color="bg-orange-50 text-orange-800"
            items={dueToday}
            emptyText="Heute nichts fällig."
          />
          <Section
            title="Diese Woche"
            icon={<span className="text-base">🔵</span>}
            color="bg-blue-50 text-blue-800"
            items={upcoming}
            emptyText="Keine weiteren Termine diese Woche."
          />
        </div>
      )}
    </div>
  );
}
