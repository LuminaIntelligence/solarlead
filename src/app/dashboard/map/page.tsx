"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Loader2, AlertCircle, Target, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ColorMode } from "@/components/map/leads-map";

const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  follow_up: "Wiedervorlage",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

const STATUS_COLOR_CLASS: Record<string, string> = {
  new: "bg-blue-500",
  reviewed: "bg-yellow-500",
  contacted: "bg-purple-500",
  follow_up: "bg-orange-500",
  qualified: "bg-green-600",
  rejected: "bg-red-600",
};

const STATUS_ORDER = ["new", "reviewed", "contacted", "follow_up", "qualified", "rejected"];

// Leaflet muss client-only geladen werden (kein SSR)
const LeadsMap = dynamic(
  () => import("@/components/map/leads-map").then((m) => m.LeadsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

interface MapLead {
  id: string;
  company_name: string;
  category: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  total_score: number;
  solar_score: number;
  status: string;
}

export default function MapPage() {
  const [leads, setLeads] = useState<MapLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("score");
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/leads/map")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLeads(data);
        else setError("Leads konnten nicht geladen werden.");
      })
      .catch(() => setError("Verbindung fehlgeschlagen."))
      .finally(() => setLoading(false));
  }, []);

  const highCount = leads.filter((l) => l.total_score >= 75).length;
  const midCount = leads.filter((l) => l.total_score >= 55 && l.total_score < 75).length;
  const lowCount = leads.filter((l) => l.total_score < 55).length;

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of leads) m[l.status] = (m[l.status] ?? 0) + 1;
    return m;
  }, [leads]);

  const visibleCount = useMemo(
    () => leads.filter((l) => !hiddenStatuses.has(l.status)).length,
    [leads, hiddenStatuses]
  );

  function toggleStatus(status: string) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-3 p-0 -m-8">
      {/* Header-Leiste */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-green-600" />
            Kartenansicht
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Lade Leads..." : `${visibleCount} von ${leads.length} Leads sichtbar`}
          </p>
        </div>

        {!loading && leads.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Modus-Toggle */}
            <div className="inline-flex rounded-lg border bg-white p-0.5 shadow-sm">
              <button
                onClick={() => setColorMode("score")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  colorMode === "score"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Target className="h-3.5 w-3.5" />
                Nach Score
              </button>
              <button
                onClick={() => setColorMode("pipeline")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  colorMode === "pipeline"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Workflow className="h-3.5 w-3.5" />
                Nach Pipeline
              </button>
            </div>

            {/* Legende Score-Modus */}
            {colorMode === "score" && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
                  <span className="text-muted-foreground">Hoch ({highCount})</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="text-muted-foreground">Mittel ({midCount})</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
                  <span className="text-muted-foreground">Niedrig ({lowCount})</span>
                </div>
              </div>
            )}

            <Badge variant="outline">{leads.length} gesamt</Badge>
          </div>
        )}
      </div>

      {/* Pipeline-Filter-Chips (nur im Pipeline-Modus oder als Filter überall) */}
      {!loading && leads.length > 0 && (
        <div className="px-6 pb-1 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Filter:</span>
            {STATUS_ORDER.map((status) => {
              const count = statusCounts[status] ?? 0;
              if (count === 0) return null;
              const hidden = hiddenStatuses.has(status);
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                    hidden
                      ? "bg-white border-slate-200 text-slate-400 opacity-60 line-through"
                      : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
                  )}
                  title={hidden ? "Einblenden" : "Ausblenden"}
                >
                  <span
                    className={cn(
                      "inline-block w-2 h-2 rounded-full",
                      STATUS_COLOR_CLASS[status]
                    )}
                  />
                  {STATUS_LABELS[status]}
                  <span className="text-slate-500">({count})</span>
                </button>
              );
            })}
            {hiddenStatuses.size > 0 && (
              <button
                onClick={() => setHiddenStatuses(new Set())}
                className="text-xs text-slate-500 hover:text-slate-700 underline ml-1"
              >
                Alle einblenden
              </button>
            )}
          </div>
        </div>
      )}

      {/* Karte */}
      <div className="flex-1 px-6 pb-6 min-h-0">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-slate-50">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Leads werden geladen...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-red-50">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
            <div className="text-center">
              <MapPin className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-lg font-medium text-muted-foreground">Noch keine Leads mit Koordinaten</p>
              <p className="text-sm text-muted-foreground mt-1">
                Leads aus der Suche oder Adresssuche erhalten automatisch Koordinaten.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full rounded-lg overflow-hidden border shadow-sm">
            <style>{`
              @import url("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
              .leads-map-popup .leaflet-popup-content-wrapper {
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                padding: 0;
              }
              .leads-map-popup .leaflet-popup-content {
                margin: 14px 14px;
              }
              .leads-map-popup .leaflet-popup-tip-container {
                margin-top: -1px;
              }
            `}</style>
            <LeadsMap
              leads={leads}
              colorMode={colorMode}
              hiddenStatuses={hiddenStatuses}
            />
          </div>
        )}
      </div>
    </div>
  );
}
