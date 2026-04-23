"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Radar, ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, PauseCircle,
  RefreshCw, Play, Pause, ChevronLeft, ChevronRight, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DiscoveryCampaign, DiscoveryLead } from "@/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiResponse {
  campaign: DiscoveryCampaign;
  leads: DiscoveryLead[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: "Ausstehend",    className: "bg-slate-700 text-slate-300" },
  running:          { label: "Läuft…",        className: "bg-blue-700/40 text-blue-300 animate-pulse" },
  completed:        { label: "Abgeschlossen", className: "bg-green-700/40 text-green-300" },
  failed:           { label: "Fehler",        className: "bg-red-700/40 text-red-300" },
  paused:           { label: "Pausiert",      className: "bg-yellow-700/40 text-yellow-300" },
};

const LEAD_STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: "Ausstehend",     className: "bg-slate-700 text-slate-300" },
  enriching:        { label: "Anreichern…",    className: "bg-blue-700/40 text-blue-300 animate-pulse" },
  ready:            { label: "Bereit",         className: "bg-yellow-700/40 text-yellow-300" },
  approved:         { label: "Genehmigt",      className: "bg-green-700/40 text-green-300" },
  rejected:         { label: "Abgelehnt",      className: "bg-red-700/40 text-red-300" },
  insufficient_data:{ label: "Zu klein",       className: "bg-slate-700/50 text-slate-400" },
};

function StatusBadge({ status }: { status: string }) {
  const { label, className } = STATUS_MAP[status] ?? { label: status, className: "bg-slate-700 text-slate-300" };
  return <Badge className={`${className} border-0 text-xs`}>{label}</Badge>;
}

function LeadStatusBadge({ status }: { status: string }) {
  const { label, className } = LEAD_STATUS_MAP[status] ?? { label: status, className: "bg-slate-700 text-slate-300" };
  return <Badge className={`${className} border-0 text-xs`}>{label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-green-400" />;
  if (status === "running")   return <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />;
  if (status === "failed")    return <XCircle className="h-5 w-5 text-red-400" />;
  if (status === "paused")    return <PauseCircle className="h-5 w-5 text-yellow-400" />;
  return <Clock className="h-5 w-5 text-slate-400" />;
}

const LEAD_STATUS_FILTERS = [
  { value: "",                 label: "Alle" },
  { value: "ready",            label: "Bereit" },
  { value: "approved",         label: "Genehmigt" },
  { value: "rejected",         label: "Abgelehnt" },
  { value: "enriching",        label: "Anreichern…" },
  { value: "insufficient_data",label: "Zu klein" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DiscoveryCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (p = page, sf = statusFilter) => {
    try {
      const res = await fetch(`/api/admin/discovery/${id}?page=${p}&status=${sf}`);
      if (!res.ok) return;
      const json: ApiResponse = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, page, statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchData(page, statusFilter);
  }, [page, statusFilter, fetchData]);

  // Auto-poll while running
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (data?.campaign?.status === "running" || data?.campaign?.status === "pending") {
      pollRef.current = setInterval(() => fetchData(page, statusFilter), 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.campaign?.status, fetchData, page, statusFilter]);

  async function handlePause() {
    setActionLoading(true);
    setActionError(null);
    try {
      await fetch(`/api/admin/discovery/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      await fetchData();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume() {
    setActionLoading(true);
    setActionError(null);
    try {
      await fetch(`/api/admin/discovery/${id}/run`, { method: "POST" });
      await fetchData();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Kampagne und alle zugehörigen Leads löschen?")) return;
    setActionLoading(true);
    try {
      await fetch(`/api/admin/discovery/${id}`, { method: "DELETE" });
      router.push("/admin/discovery");
    } catch {
      setActionLoading(false);
    }
  }

  async function handleBulkAction(action: "approve" | "reject") {
    if (!selected.size) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/discovery/${id}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lead_ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fehler");
      setSelected(new Set());
      await fetchData();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setActionLoading(false);
    }
  }

  function toggleSelect(leadId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function toggleAll() {
    const readyIds = (data?.leads ?? []).filter((l) => l.status === "ready").map((l) => l.id);
    if (readyIds.every((id) => selected.has(id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        readyIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        readyIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[#B2D082]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-slate-400 py-16">
        <p>Kampagne nicht gefunden.</p>
        <Link href="/admin/discovery" className="text-blue-400 hover:underline text-sm mt-2 inline-block">
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const { campaign, leads, total, pageSize } = data;
  const totalPages = Math.ceil(total / pageSize);
  const areas = (campaign.areas as { value: string }[]) ?? [];
  const cats  = (campaign.categories as string[]) ?? [];
  const readyLeads = leads.filter((l) => l.status === "ready");
  const allReadySelected = readyLeads.length > 0 && readyLeads.every((l) => selected.has(l.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/admin/discovery" className="mt-0.5 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">{campaign.name}</h1>
              <StatusIcon status={campaign.status} />
              <StatusBadge status={campaign.status} />
            </div>
            {campaign.description && (
              <p className="text-slate-400 text-sm mt-0.5">{campaign.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {areas.slice(0, 5).map((a) => (
                <span key={a.value} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                  {a.value}
                </span>
              ))}
              {areas.length > 5 && (
                <span className="text-xs text-slate-500">+{areas.length - 5} weitere</span>
              )}
            </div>
          </div>
        </div>

        {/* Campaign actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {campaign.status === "running" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePause}
              disabled={actionLoading}
              className="border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/20"
            >
              <Pause className="h-3.5 w-3.5 mr-1" />
              Pausieren
            </Button>
          )}
          {(campaign.status === "paused" || campaign.status === "failed") && (
            <Button
              size="sm"
              onClick={handleResume}
              disabled={actionLoading}
              className="text-[#1F3D2E] font-semibold"
              style={{ backgroundColor: "#B2D082" }}
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              Fortsetzen
            </Button>
          )}
          {["pending", "failed", "completed"].includes(campaign.status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={actionLoading}
              className="border-red-800/50 text-red-400 hover:bg-red-900/20"
            >
              Löschen
            </Button>
          )}
        </div>
      </div>

      {/* Error message from campaign */}
      {campaign.error_message && (
        <div className="flex items-start gap-2 rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{campaign.error_message}</span>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Branchen",           value: cats.length },
          { label: "Entdeckt",           value: campaign.total_discovered },
          { label: "Bereit zur Prüfung", value: campaign.total_ready },
          { label: "Genehmigt",          value: campaign.total_approved, highlight: true },
          { label: "Erstellt",           value: new Date(campaign.created_at).toLocaleDateString("de-DE"), small: true },
        ].map((s) => (
          <Card key={s.label} className="bg-slate-900 border-slate-800">
            <CardContent className="pt-4 pb-3">
              <div
                className={`text-xl font-bold ${s.highlight ? "text-[#B2D082]" : "text-white"} ${s.small ? "text-base" : ""}`}
              >
                {s.value}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leads table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base">
              Entdeckte Leads
              {total > 0 && (
                <span className="text-slate-400 font-normal text-sm ml-2">({total})</span>
              )}
            </CardTitle>

            {/* Bulk actions */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">{selected.size} ausgewählt</span>
                <Button
                  size="sm"
                  onClick={() => handleBulkAction("approve")}
                  disabled={actionLoading}
                  className="text-[#1F3D2E] font-semibold text-xs"
                  style={{ backgroundColor: "#B2D082" }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Genehmigen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAction("reject")}
                  disabled={actionLoading}
                  className="border-red-800/50 text-red-400 hover:bg-red-900/20 text-xs"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Ablehnen
                </Button>
              </div>
            )}
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {LEAD_STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatusFilter(f.value); setPage(1); setSelected(new Set()); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? "text-[#1F3D2E]"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
                style={statusFilter === f.value ? { backgroundColor: "#B2D082" } : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {leads.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              {campaign.status === "running" || campaign.status === "pending" ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                  <p className="text-sm">Kampagne läuft – Leads werden entdeckt…</p>
                </div>
              ) : (
                <p className="text-sm">Keine Leads in dieser Ansicht.</p>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allReadySelected}
                      onChange={toggleAll}
                      className="accent-[#B2D082]"
                    />
                  </th>
                  {["Status", "Unternehmen", "Stadt", "Branche", "Dachfläche", "Score", "Kontakte", "Aktion"].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const contacts = (lead.contacts as { name?: string; email?: string }[] | null) ?? [];
                  const isReady = lead.status === "ready";
                  const isSelected = selected.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={`border-b border-slate-800 last:border-0 transition-colors ${
                        isSelected ? "bg-slate-800/70" : "hover:bg-slate-800/30"
                      }`}
                    >
                      <td className="px-4 py-3">
                        {isReady && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(lead.id)}
                            className="accent-[#B2D082]"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <LeadStatusBadge status={lead.status} />
                      </td>
                      <td className="px-4 py-3 text-white font-medium max-w-[180px] truncate">
                        {lead.company_name ?? lead.place_name ?? "–"}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{lead.city ?? "–"}</td>
                      <td className="px-4 py-3 text-slate-400 capitalize">
                        {lead.category?.replace(/_/g, " ") ?? "–"}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {lead.roof_area_m2 ? `${Math.round(lead.roof_area_m2).toLocaleString("de-DE")} m²` : "–"}
                      </td>
                      <td className="px-4 py-3">
                        {lead.total_score != null ? (
                          <span
                            className={`font-bold ${
                              lead.total_score >= 70
                                ? "text-[#B2D082]"
                                : lead.total_score >= 50
                                ? "text-yellow-400"
                                : "text-slate-400"
                            }`}
                          >
                            {lead.total_score}
                          </span>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {contacts.length > 0
                          ? `${contacts.length} Kontakt${contacts.length !== 1 ? "e" : ""}`
                          : "–"}
                      </td>
                      <td className="px-4 py-3">
                        {isReady && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                setSelected(new Set([lead.id]));
                                handleBulkAction("approve");
                              }}
                              disabled={actionLoading}
                              className="text-xs px-2 py-1 rounded text-[#1F3D2E] font-medium transition-opacity hover:opacity-80"
                              style={{ backgroundColor: "#B2D082" }}
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setSelected(new Set([lead.id]));
                                handleBulkAction("reject");
                              }}
                              disabled={actionLoading}
                              className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
              <span className="text-xs text-slate-500">
                Seite {page} von {totalPages} ({total} Leads)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-slate-700 text-slate-400 hover:text-white h-7 px-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="border-slate-700 text-slate-400 hover:text-white h-7 px-2"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
