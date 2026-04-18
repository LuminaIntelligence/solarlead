"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, ChevronRight, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PipelineLead {
  id: string;
  company_name: string;
  category: string;
  city: string;
  total_score: number;
  status: string;
  next_contact_date: string | null;
  win_probability: number | null;
}

const COLUMNS: { key: string; label: string; color: string; headerColor: string; countColor: string }[] = [
  { key: "new",       label: "Neu",          color: "border-blue-200 bg-blue-50/40",    headerColor: "bg-blue-100 text-blue-800",    countColor: "bg-blue-200 text-blue-700" },
  { key: "reviewed",  label: "Geprüft",      color: "border-yellow-200 bg-yellow-50/40", headerColor: "bg-yellow-100 text-yellow-800", countColor: "bg-yellow-200 text-yellow-700" },
  { key: "contacted", label: "Kontaktiert",  color: "border-purple-200 bg-purple-50/40", headerColor: "bg-purple-100 text-purple-800", countColor: "bg-purple-200 text-purple-700" },
  { key: "qualified", label: "Qualifiziert", color: "border-green-200 bg-green-50/40",   headerColor: "bg-green-100 text-green-800",  countColor: "bg-green-200 text-green-700" },
  { key: "rejected",  label: "Abgelehnt",   color: "border-red-200 bg-red-50/40",      headerColor: "bg-red-100 text-red-800",      countColor: "bg-red-200 text-red-700" },
];

const NEXT_STATUS: Record<string, string | null> = {
  new:       "reviewed",
  reviewed:  "contacted",
  contacted: "qualified",
  qualified: null,
  rejected:  null,
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

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function KanbanBoard() {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/pipeline");
      const data = await res.json();
      if (Array.isArray(data)) setLeads(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function moveStatus(leadId: string, newStatus: string) {
    setMoving(leadId);
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setLeads((prev) =>
        prev.map((l) => l.id === leadId ? { ...l, status: newStatus } : l)
      );
    } finally {
      setMoving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const grouped = COLUMNS.reduce<Record<string, PipelineLead[]>>((acc, col) => {
    acc[col.key] = leads.filter((l) => l.status === col.key);
    return acc;
  }, {});

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[calc(100vh-12rem)]">
      {COLUMNS.map((col) => {
        const colLeads = grouped[col.key] ?? [];
        return (
          <div
            key={col.key}
            className={cn("flex flex-col rounded-xl border-2 min-w-[260px] w-[260px] shrink-0", col.color)}
          >
            {/* Column Header */}
            <div className={cn("flex items-center justify-between px-3 py-2.5 rounded-t-[10px]", col.headerColor)}>
              <span className="text-sm font-semibold">{col.label}</span>
              <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", col.countColor)}>
                {colLeads.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 p-2 overflow-y-auto max-h-[calc(100vh-14rem)]">
              {colLeads.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">Keine Leads</p>
              ) : (
                colLeads.map((lead) => {
                  const nextStatus = NEXT_STATUS[lead.status];
                  const nextCol = COLUMNS.find((c) => c.key === nextStatus);
                  const overdue = isOverdue(lead.next_contact_date);

                  return (
                    <div
                      key={lead.id}
                      className="rounded-lg bg-white border border-slate-200 shadow-sm p-3 space-y-2 hover:shadow-md transition-shadow"
                    >
                      {/* Company + Score */}
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="text-sm font-semibold leading-tight hover:text-green-700 hover:underline line-clamp-2"
                        >
                          {lead.company_name}
                        </Link>
                        <Badge
                          variant="secondary"
                          className={cn("text-xs shrink-0 font-bold", scoreColor(lead.total_score))}
                        >
                          {lead.total_score}
                        </Badge>
                      </div>

                      {/* City + Category */}
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-muted-foreground">{lead.city}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[lead.category] ?? lead.category}
                        </span>
                      </div>

                      {/* Next Contact Date */}
                      {lead.next_contact_date && (
                        <div className={cn(
                          "text-xs rounded px-1.5 py-0.5 inline-flex items-center gap-1",
                          overdue ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                        )}>
                          {overdue ? "⚠ " : "📅 "}{formatDate(lead.next_contact_date)}
                        </div>
                      )}

                      {/* Move Button */}
                      {nextStatus && nextCol && (
                        <button
                          onClick={() => moveStatus(lead.id, nextStatus)}
                          disabled={moving === lead.id}
                          className={cn(
                            "w-full flex items-center justify-center gap-1 text-xs font-medium py-1 rounded-md border transition-colors",
                            "border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600",
                            moving === lead.id && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {moving === lead.id ? (
                            <RotateCcw className="h-3 w-3 animate-spin" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          → {nextCol.label}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
