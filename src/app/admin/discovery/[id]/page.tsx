"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Radar, ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, PauseCircle,
  RefreshCw, Play, Pause, ChevronLeft, ChevronRight, AlertTriangle,
  Mail, X, UserSearch,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DiscoveryCampaign, DiscoveryLead } from "@/types/database";
import type { TemplateType } from "@/lib/providers/email/templates";

// ─── Test Email Modal ─────────────────────────────────────────────────────────

const TEMPLATE_OPTIONS: { value: TemplateType; label: string; color: string }[] = [
  { value: "erstkontakt", label: "Erstkontakt",  color: "bg-blue-700/40 text-blue-300 border-blue-700/50" },
  { value: "followup",    label: "Follow-up",    color: "bg-yellow-700/40 text-yellow-300 border-yellow-700/50" },
  { value: "finale",      label: "Finale",       color: "bg-orange-700/40 text-orange-300 border-orange-700/50" },
];

function TestEmailModal({
  campaignId,
  leads,
  onClose,
}: {
  campaignId: string;
  leads: DiscoveryLead[];
  onClose: () => void;
}) {
  const [toEmail, setToEmail] = useState("");
  const [templateType, setTemplateType] = useState<TemplateType>("erstkontakt");
  const [leadId, setLeadId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Only show approved/ready leads for realistic preview
  const previewLeads = leads.filter((l) => l.status === "ready" || l.status === "approved");

  async function handleSend() {
    if (!toEmail.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/discovery/${campaignId}/test-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toEmail.trim(),
          template_type: templateType,
          lead_id: leadId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler");
      setResult({ ok: true, message: data.message });
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Unbekannter Fehler" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#B2D082]" />
            <h2 className="text-white font-semibold text-sm">Test-E-Mail senden</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Template selector */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Template</label>
            <div className="flex gap-2">
              {TEMPLATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTemplateType(opt.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                    templateType === opt.value
                      ? opt.color
                      : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lead selector */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              Lead-Daten für Vorschau{" "}
              <span className="text-slate-500">(optional — sonst Beispieldaten)</span>
            </label>
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#B2D082]/50"
            >
              <option value="">— Beispieldaten verwenden —</option>
              {previewLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company_name ?? l.place_name ?? l.id} ({l.city ?? "?"})
                </option>
              ))}
            </select>
            {previewLeads.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Noch keine genehmigten / bereiten Leads — es werden Beispieldaten verwendet.
              </p>
            )}
          </div>

          {/* Email input */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              Empfänger-E-Mail <span className="text-red-400">*</span>
            </label>
            <Input
              type="email"
              placeholder="deine@email.de"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          {/* Result */}
          {result && (
            <div
              className={`rounded-lg p-3 text-xs ${
                result.ok
                  ? "bg-green-900/20 border border-green-800/40 text-green-300"
                  : "bg-red-900/20 border border-red-800/40 text-red-300"
              }`}
            >
              {result.ok ? "✓ " : "✕ "}{result.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Schließen
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || !toEmail.trim()}
              className="flex-1 text-[#1F3D2E] font-semibold"
              style={{ backgroundColor: "#B2D082" }}
            >
              {sending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Senden…
                </>
              ) : (
                <>
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  Test senden
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiResponse {
  campaign: DiscoveryCampaign;
  leads: DiscoveryLead[];
  total: number;
  page: number;
  pageSize: number;
  enrichmentPending: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: "Ausstehend",    className: "bg-slate-100 text-slate-600" },
  running:          { label: "Läuft…",        className: "bg-blue-100 text-blue-700 animate-pulse" },
  completed:        { label: "Abgeschlossen", className: "bg-green-100 text-green-700" },
  failed:           { label: "Fehler",        className: "bg-red-100 text-red-700" },
  paused:           { label: "Pausiert",      className: "bg-yellow-100 text-yellow-700" },
};

const LEAD_STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:          { label: "Ausstehend",     className: "bg-slate-100 text-slate-600" },
  enriching:        { label: "Anreichern…",    className: "bg-blue-100 text-blue-700 animate-pulse" },
  ready:            { label: "Bereit",         className: "bg-yellow-100 text-yellow-700" },
  approved:         { label: "Genehmigt",      className: "bg-green-100 text-green-700" },
  rejected:         { label: "Abgelehnt",      className: "bg-red-100 text-red-700" },
  insufficient_data:{ label: "Zu klein",       className: "bg-slate-100 text-slate-500" },
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
  const [showTestModal, setShowTestModal] = useState(false);
  const [findContactsState, setFindContactsState] = useState<Record<string, "loading" | "done" | "error">>({});
  const [findContactsResult, setFindContactsResult] = useState<Record<string, string>>({});
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

  // Auto-poll while running OR while enrichment is still in progress in background
  const isEnrichmentActive = (data?.enrichmentPending ?? 0) > 0;
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const shouldPoll =
      data?.campaign?.status === "running" ||
      data?.campaign?.status === "pending" ||
      isEnrichmentActive;
    if (shouldPoll) {
      pollRef.current = setInterval(() => fetchData(page, statusFilter), 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.campaign?.status, isEnrichmentActive, fetchData, page, statusFilter]);

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

  async function handleForceComplete() {
    if (!confirm("Kampagne als abgeschlossen markieren?")) return;
    await fetch(`/api/admin/discovery/${id}/force-complete`, { method: "POST" });
    await fetchData();
  }

  async function handleFindContacts(discoveryLeadId: string) {
    setFindContactsState((s) => ({ ...s, [discoveryLeadId]: "loading" }));
    setFindContactsResult((s) => ({ ...s, [discoveryLeadId]: "" }));
    try {
      const res = await fetch(`/api/admin/discovery/${id}/find-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: discoveryLeadId }),
      });
      const json = await res.json();
      setFindContactsState((s) => ({ ...s, [discoveryLeadId]: json.found > 0 ? "done" : "error" }));
      setFindContactsResult((s) => ({ ...s, [discoveryLeadId]: json.message }));
      if (json.found > 0) await fetchData();
    } catch {
      setFindContactsState((s) => ({ ...s, [discoveryLeadId]: "error" }));
      setFindContactsResult((s) => ({ ...s, [discoveryLeadId]: "Netzwerkfehler" }));
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
      <div className="text-center text-slate-500 py-16">
        <p>Kampagne nicht gefunden.</p>
        <Link href="/admin/discovery" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
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
          <Link href="/admin/discovery" className="mt-0.5 text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900">{campaign.name}</h1>
              <StatusIcon status={campaign.status} />
              <StatusBadge status={campaign.status} />
            </div>
            {campaign.description && (
              <p className="text-slate-500 text-sm mt-0.5">{campaign.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {areas.slice(0, 5).map((a) => (
                <span key={a.value} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
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
            className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTestModal(true)}
            className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          >
            <Mail className="h-3.5 w-3.5 mr-1.5" />
            Test-E-Mail
          </Button>
          {campaign.status === "running" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePause}
                disabled={actionLoading}
                className="border-yellow-300 text-yellow-700 hover:bg-yellow-50"
              >
                <Pause className="h-3.5 w-3.5 mr-1" />
                Pausieren
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleForceComplete}
                disabled={actionLoading}
                title="Kampagne manuell als abgeschlossen markieren (z.B. wenn der Prozess hängt)"
                className="border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Beenden
              </Button>
            </>
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
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              Löschen
            </Button>
          )}
        </div>
      </div>

      {/* Error message from campaign */}
      {campaign.error_message && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{campaign.error_message}</span>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
          <Card key={s.label} className="bg-white border-slate-200">
            <CardContent className="pt-4 pb-3">
              <div
                className={`text-xl font-bold ${s.highlight ? "text-[#B2D082]" : "text-slate-900"} ${s.small ? "text-base" : ""}`}
              >
                {s.value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Enrichment progress banner — shown when campaign is done but background enrichment still runs */}
      {isEnrichmentActive && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-800">
              Anreicherung läuft im Hintergrund
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              {data.enrichmentPending} Lead{data.enrichmentPending !== 1 ? "s" : ""} werden noch angereichert
              (Solar-Analyse, Kontaktsuche, Scoring) — die Seite aktualisiert sich automatisch.
            </p>
          </div>
          {/* Mini progress bar */}
          {campaign.total_discovered > 0 && (
            <div className="shrink-0 w-32">
              <div className="flex justify-between text-xs text-blue-500 mb-1">
                <span>{campaign.total_discovered - data.enrichmentPending} / {campaign.total_discovered}</span>
                <span>{Math.round(((campaign.total_discovered - data.enrichmentPending) / campaign.total_discovered) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.round(((campaign.total_discovered - data.enrichmentPending) / campaign.total_discovered) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leads table */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-slate-900 text-base">
              Entdeckte Leads
              {total > 0 && (
                <span className="text-slate-500 font-normal text-sm ml-2">({total})</span>
              )}
            </CardTitle>

            {/* Bulk actions */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{selected.size} ausgewählt</span>
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
                  className="border-red-300 text-red-600 hover:bg-red-50 text-xs"
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
                    : "bg-slate-100 text-slate-500 hover:text-slate-900"
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
            <div className="py-12 text-center text-slate-500">
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
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allReadySelected}
                      onChange={toggleAll}
                      className="accent-[#B2D082]"
                    />
                  </th>
                  {["Status", "Unternehmen", "Stadt", "Branche", "Dachfläche", "Score", "Kontakte", "Aktion"].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const contactCount = lead.contact_count ?? 0;
                  const isReady = lead.status === "ready";
                  const isSelected = selected.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={`border-b border-slate-200 last:border-0 transition-colors ${
                        isSelected ? "bg-slate-100" : "hover:bg-slate-50/80"
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
                      <td className="px-4 py-3 text-slate-900 font-medium max-w-[180px] truncate">
                        {lead.company_name ?? lead.place_name ?? "–"}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{lead.city ?? "–"}</td>
                      <td className="px-4 py-3 text-slate-500 capitalize">
                        {lead.category?.replace(/_/g, " ") ?? "–"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {lead.max_array_area_m2 ? `${Math.round(lead.max_array_area_m2).toLocaleString("de-DE")} m²` : "–"}
                      </td>
                      <td className="px-4 py-3">
                        {lead.total_score != null ? (
                          <span
                            className={`font-bold ${
                              lead.total_score >= 70
                                ? "text-[#B2D082]"
                                : lead.total_score >= 50
                                ? "text-yellow-600"
                                : "text-slate-500"
                            }`}
                          >
                            {lead.total_score}
                          </span>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        <div className="flex items-center gap-1.5">
                          {contactCount > 0
                            ? <span className="text-green-600 font-medium">{contactCount} Kontakt{contactCount !== 1 ? "e" : ""}</span>
                            : <span className="text-slate-400">–</span>
                          }
                          {/* Re-enrich button — only if lead has a website */}
                          {lead.website && (
                            <button
                              title={findContactsResult[lead.id] || "Kontakt neu suchen"}
                              onClick={() => handleFindContacts(lead.id)}
                              disabled={findContactsState[lead.id] === "loading"}
                              className={`p-0.5 rounded transition-colors ${
                                findContactsState[lead.id] === "done"
                                  ? "text-green-600"
                                  : findContactsState[lead.id] === "error"
                                  ? "text-red-400"
                                  : "text-slate-300 hover:text-slate-600"
                              }`}
                            >
                              {findContactsState[lead.id] === "loading"
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <UserSearch className="h-3 w-3" />
                              }
                            </button>
                          )}
                        </div>
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
                              className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
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
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                Seite {page} von {totalPages} ({total} Leads)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-slate-300 text-slate-500 hover:text-slate-900 h-7 px-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="border-slate-300 text-slate-500 hover:text-slate-900 h-7 px-2"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Email Modal */}
      {showTestModal && (
        <TestEmailModal
          campaignId={id}
          leads={data.leads}
          onClose={() => setShowTestModal(false)}
        />
      )}
    </div>
  );
}
