"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Sun, Loader2, ArrowLeft, Download, RotateCcw, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { getCategoryLabel, CATEGORY_EMOJI } from "@/lib/constants/categories";

interface SolarLead {
  id: string;
  company_name: string | null;
  city: string | null;
  category: string | null;
  total_score: number | null;
  existing_solar_at: string | null;
  existing_solar_source: string | null;
  updated_at: string;
}

interface ApiResponse {
  rows: SolarLead[];
  counts: {
    total: number;
    this_week: number;
    by_source: Record<string, number>;
  };
}

// Hübschere Labels für die Quellen
const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  discovery_enrichment: { label: "Discovery (Anlage)", color: "bg-blue-100 text-blue-800" },
  osm_cron:             { label: "OSM-Cron (nightly)", color: "bg-green-100 text-green-800" },
  osm_backfill:         { label: "OSM-Backfill (manuell)", color: "bg-green-100 text-green-800" },
  mastr_backfill:       { label: "MaStR-Import", color: "bg-purple-100 text-purple-800" },
  manual:               { label: "Manuell markiert", color: "bg-amber-100 text-amber-800" },
  sweep:                { label: "Outreach-Sweep", color: "bg-slate-100 text-slate-700" },
  legacy:               { label: "Vor Tracking-Einführung", color: "bg-slate-100 text-slate-500" },
  unbekannt:            { label: "Unbekannt", color: "bg-slate-100 text-slate-500" },
};

function sourceLabel(src: string | null) {
  const key = src ?? "unbekannt";
  return SOURCE_LABELS[key] ?? { label: key, color: "bg-slate-100 text-slate-700" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export default function ExistingSolarPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter) params.set("source", sourceFilter);
      const res = await fetch(`/api/admin/leads/existing-solar?${params.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function reactivate(leadId: string, companyName: string) {
    if (!confirm(
      `Lead "${companyName}" wieder aktivieren? Status zurück auf 'new'. ` +
      `Outreach-Jobs werden NICHT automatisch reaktiviert — du müsstest den ` +
      `Lead bei Bedarf erneut in einen Pool/Batch nehmen.`
    )) return;
    setReactivatingId(leadId);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/reactivate-from-solar`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: "Reaktiviert", description: companyName });
      await load();
    } finally {
      setReactivatingId(null);
    }
  }

  function exportCsv() {
    if (!data) return;
    const headers = ["company_name", "city", "category", "total_score", "existing_solar_at", "existing_solar_source", "lead_id"];
    const lines = [
      headers.join(","),
      ...data.rows.map((r) =>
        [
          JSON.stringify(r.company_name ?? ""),
          JSON.stringify(r.city ?? ""),
          JSON.stringify(r.category ?? ""),
          r.total_score ?? "",
          r.existing_solar_at ?? "",
          r.existing_solar_source ?? "",
          r.id,
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `existing-solar-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sun className="h-7 w-7 text-orange-500" />
            Bereits Solar vorhanden
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Leads bei denen schon eine Solar-Anlage auf dem Dach erkannt wurde —
            werden automatisch aus allen Outreach-Kampagnen ausgeschlossen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/leads"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Alle Leads
          </Link>
          {data && data.rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Gesamt</div>
            <div className="text-2xl font-bold mt-1">{data?.counts.total ?? "—"}</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-amber-700 font-medium">Diese Woche neu</div>
            <div className="text-2xl font-bold mt-1 text-amber-900">{data?.counts.this_week ?? "—"}</div>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium mb-2">Nach Quelle</div>
            <div className="flex flex-wrap gap-1.5">
              {data && Object.entries(data.counts.by_source)
                .sort(([, a], [, b]) => b - a)
                .map(([src, count]) => {
                  const meta = sourceLabel(src);
                  const active = sourceFilter === src;
                  return (
                    <button
                      key={src}
                      onClick={() => setSourceFilter(active ? "" : src)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        active
                          ? "ring-2 ring-blue-500 " + meta.color
                          : meta.color + " hover:ring-1 hover:ring-slate-300"
                      }`}
                    >
                      {meta.label}: {count}
                    </button>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      {sourceFilter && (
        <div className="text-xs text-slate-600 flex items-center gap-2">
          Filter aktiv: <strong>{sourceLabel(sourceFilter).label}</strong>
          <button
            onClick={() => setSourceFilter("")}
            className="text-blue-600 hover:underline"
          >
            zurücksetzen
          </button>
        </div>
      )}

      {/* Tabelle */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {data ? `${data.rows.length} Leads` : "Lädt…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              Keine existing_solar-Leads
              {sourceFilter ? ` mit Quelle "${sourceLabel(sourceFilter).label}"` : ""}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Firma</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Erkannt am</th>
                    <th className="px-4 py-2 font-medium">Quelle</th>
                    <th className="px-4 py-2 font-medium">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const meta = sourceLabel(r.existing_solar_source);
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/dashboard/leads/${r.id}`}
                            className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                          >
                            {r.company_name ?? "—"}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {r.city ?? ""}
                            {r.category
                              ? ` · ${CATEGORY_EMOJI[r.category] ?? ""} ${getCategoryLabel(r.category)}`
                              : ""}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.total_score != null ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                r.total_score >= 80
                                  ? "bg-green-100 text-green-800"
                                  : r.total_score >= 60
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {r.total_score}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {formatDate(r.existing_solar_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/dashboard/leads/${r.id}`}
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              Detail <ExternalLink className="h-3 w-3" />
                            </Link>
                            <button
                              onClick={() => reactivate(r.id, r.company_name ?? "Lead")}
                              disabled={reactivatingId === r.id}
                              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-orange-700"
                              title="Falsch erkannt? Lead wieder aktivieren"
                            >
                              {reactivatingId === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              Reaktivieren
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
