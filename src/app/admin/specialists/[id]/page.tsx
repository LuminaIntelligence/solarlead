"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, ExternalLink, Download, UserCheck,
  Calendar, MessageSquare, RotateCcw, Briefcase, FileSearch,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { outcomeMeta } from "@/lib/constants/reply-outcomes";
import { getCategoryLabel, CATEGORY_EMOJI } from "@/lib/constants/categories";
import type { ReplyOutcome } from "@/types/database";

interface AssignedJob {
  id: string;
  lead_id: string;
  status: string;
  channel: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  outcome: ReplyOutcome | null;
  outcome_at: string | null;
  replied_at: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  closed_value_eur: number | null;
  created_at: string;
  sent_at: string | null;
  linkedin_sent_at: string | null;
  solar_lead_mass: { total_score: number | null; status: string | null } | null;
}

interface OwnedLead {
  id: string;
  company_name: string | null;
  city: string | null;
  category: string | null;
  total_score: number | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  linkedin_url: string | null;
}

interface Activity {
  id: string;
  job_id: string;
  kind: string;
  content: string | null;
  created_at: string;
}

interface ApiResponse {
  specialist: { user_id: string; email: string | null; role: string };
  assigned_jobs: AssignedJob[];
  owned_leads: OwnedLead[];
  activities: Activity[];
  counts_by_status: Record<string, number>;
  counts_by_outcome: Record<string, number>;
  owned_counts_by_status: Record<string, number>;
  total_won_value_eur: number;
}

type Tab = "assigned" | "owned" | "activities";

const JOB_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Offen", color: "bg-amber-100 text-amber-800" },
  sent: { label: "Gesendet", color: "bg-blue-100 text-blue-800" },
  replied: { label: "Beantwortet", color: "bg-green-100 text-green-800" },
  cancelled: { label: "Storniert", color: "bg-slate-100 text-slate-500" },
};

const LEAD_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new: { label: "Neu", color: "bg-blue-100 text-blue-800" },
  reviewed: { label: "Geprüft", color: "bg-indigo-100 text-indigo-800" },
  contacted: { label: "Kontaktiert", color: "bg-purple-100 text-purple-800" },
  qualified: { label: "Qualifiziert", color: "bg-green-100 text-green-800" },
  rejected: { label: "Abgelehnt", color: "bg-red-100 text-red-800" },
  existing_solar: { label: "Bereits Solar", color: "bg-orange-100 text-orange-800" },
};

function statusBadge(map: Record<string, { label: string; color: string }>, st: string | null) {
  if (!st) return { label: "—", color: "bg-slate-100 text-slate-500" };
  return map[st] ?? { label: st, color: "bg-slate-100 text-slate-700" };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "gerade eben";
  if (ms < 3600_000) return `vor ${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `vor ${Math.floor(ms / 3600_000)} h`;
  return `vor ${Math.floor(ms / 86400_000)} Tagen`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

export default function SpecialistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("assigned");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [team, setTeam] = useState<Array<{ user_id: string; email: string | null; role: string }>>([]);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/specialists/${id}`);
      if (res.ok) setData(await res.json());
      else {
        const d = await res.json();
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/reply-management/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.team) setTeam(d.team); })
      .catch(() => {});
  }, []);

  const filteredAssigned = (() => {
    if (!data) return [];
    if (statusFilter === "all") return data.assigned_jobs;
    return data.assigned_jobs.filter((j) => j.status === statusFilter);
  })();

  const filteredOwned = (() => {
    if (!data) return [];
    if (statusFilter === "all") return data.owned_leads;
    return data.owned_leads.filter((l) => l.status === statusFilter);
  })();

  async function reassign(jobId: string, newUserId: string | null, label: string) {
    setReassigningId(jobId);
    try {
      const res = await fetch(`/api/admin/outreach/jobs/${jobId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: newUserId }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: "Re-assigned", description: `→ ${label}` });
      await load();
    } finally {
      setReassigningId(null);
    }
  }

  function exportCsv() {
    if (!data) return;
    let lines: string[];
    if (activeTab === "assigned") {
      const headers = ["company_name", "city", "category", "score", "channel", "status", "outcome", "contact_name", "last_activity_at", "next_action_at", "closed_value_eur", "lead_id", "job_id"];
      lines = [
        headers.join(","),
        ...filteredAssigned.map((j) =>
          [
            JSON.stringify(j.company_name ?? ""),
            JSON.stringify(j.company_city ?? ""),
            JSON.stringify(j.company_category ?? ""),
            j.solar_lead_mass?.total_score ?? "",
            j.channel,
            j.status,
            j.outcome ?? "",
            JSON.stringify(j.contact_name ?? ""),
            j.last_activity_at ?? "",
            j.next_action_at ?? "",
            j.closed_value_eur ?? "",
            j.lead_id,
            j.id,
          ].join(",")
        ),
      ];
    } else if (activeTab === "owned") {
      const headers = ["company_name", "city", "category", "score", "status", "created_at", "lead_id"];
      lines = [
        headers.join(","),
        ...filteredOwned.map((l) =>
          [
            JSON.stringify(l.company_name ?? ""),
            JSON.stringify(l.city ?? ""),
            JSON.stringify(l.category ?? ""),
            l.total_score ?? "",
            l.status ?? "",
            l.created_at,
            l.id,
          ].join(",")
        ),
      ];
    } else {
      return;
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `specialist-${data.specialist.email ?? id}-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/admin/reply-management"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Reply-Management
          </Link>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserCheck className="h-7 w-7 text-blue-700" />
            {data?.specialist.email ?? id.slice(0, 8)}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Komplette Pipeline-Sicht: zugewiesene Jobs, selbst angelegte Leads,
            Aktivitäten.
            {data?.specialist.role && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {data.specialist.role}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (activeTab === "assigned" ? filteredAssigned.length : filteredOwned.length) > 0 && activeTab !== "activities" && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Zugewiesene Jobs</div>
            <div className="text-2xl font-bold mt-1">{data?.assigned_jobs.length ?? "—"}</div>
            {data && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                {data.counts_by_status.pending ?? 0} offen ·{" "}
                {data.counts_by_status.sent ?? 0} gesendet ·{" "}
                {data.counts_by_status.replied ?? 0} replies
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Eigene Leads</div>
            <div className="text-2xl font-bold mt-1">{data?.owned_leads.length ?? "—"}</div>
            {data && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                selbst angelegt
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-green-700 font-medium">Won</div>
            <div className="text-2xl font-bold mt-1 text-green-900">
              {data?.counts_by_outcome.closed_won ?? "—"}
            </div>
            {data && data.total_won_value_eur > 0 && (
              <div className="text-xs text-green-700 mt-0.5">
                €{data.total_won_value_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Aktiv (Replies)</div>
            <div className="text-2xl font-bold mt-1">
              {data
                ? ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"].reduce(
                    (sum, oc) => sum + (data.counts_by_outcome[oc] ?? 0),
                    0
                  )
                : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Aktivitäten</div>
            <div className="text-2xl font-bold mt-1">{data?.activities.length ?? "—"}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">letzte 50</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b">
        <button
          onClick={() => { setActiveTab("assigned"); setStatusFilter("all"); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "assigned"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5 inline mr-1" />
          Zugewiesene Outreach-Jobs ({data?.assigned_jobs.length ?? 0})
        </button>
        <button
          onClick={() => { setActiveTab("owned"); setStatusFilter("all"); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "owned"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileSearch className="h-3.5 w-3.5 inline mr-1" />
          Selbst angelegte Leads ({data?.owned_leads.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab("activities")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "activities"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
          Aktivitäten ({data?.activities.length ?? 0})
        </button>
      </div>

      {/* Sub-Filter pro Tab */}
      {activeTab === "assigned" && data && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              statusFilter === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            Alle ({data.assigned_jobs.length})
          </button>
          {["pending", "sent", "replied", "cancelled"].map((st) => {
            const count = data.counts_by_status[st] ?? 0;
            if (count === 0) return null;
            const meta = JOB_STATUS_LABEL[st];
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                  statusFilter === st
                    ? "bg-slate-900 text-white border-slate-900"
                    : meta.color + " border-transparent hover:ring-1 hover:ring-slate-300"
                }`}
              >
                {meta.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {activeTab === "owned" && data && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              statusFilter === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            Alle ({data.owned_leads.length})
          </button>
          {Object.entries(data.owned_counts_by_status)
            .sort(([, a], [, b]) => b - a)
            .map(([st, count]) => {
              const meta = statusBadge(LEAD_STATUS_LABEL, st);
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    statusFilter === st
                      ? "bg-slate-900 text-white border-slate-900"
                      : meta.color + " border-transparent hover:ring-1 hover:ring-slate-300"
                  }`}
                >
                  {meta.label} ({count})
                </button>
              );
            })}
        </div>
      )}

      {/* Inhalt */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {activeTab === "assigned"
              ? `${filteredAssigned.length} Outreach-Jobs`
              : activeTab === "owned"
              ? `${filteredOwned.length} eigene Leads`
              : `${data?.activities.length ?? 0} Aktivitäten`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : activeTab === "assigned" ? (
            filteredAssigned.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Keine zugewiesenen Outreach-Jobs in dieser Auswahl.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left text-xs">
                      <th className="px-4 py-2 font-medium">Firma</th>
                      <th className="px-4 py-2 font-medium">Kontakt</th>
                      <th className="px-4 py-2 font-medium">Score</th>
                      <th className="px-4 py-2 font-medium">Channel</th>
                      <th className="px-4 py-2 font-medium">Status / Stage</th>
                      <th className="px-4 py-2 font-medium">Letzte Aktivität</th>
                      <th className="px-4 py-2 font-medium">Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssigned.map((j) => {
                      const jobStMeta = statusBadge(JOB_STATUS_LABEL, j.status);
                      const ocMeta = j.outcome ? outcomeMeta(j.outcome) : null;
                      const score = j.solar_lead_mass?.total_score ?? null;
                      return (
                        <tr key={j.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/dashboard/leads/${j.lead_id}`}
                              className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                            >
                              {j.company_name ?? "—"}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {j.company_city ?? ""}
                              {j.company_category
                                ? ` · ${CATEGORY_EMOJI[j.company_category] ?? ""} ${getCategoryLabel(j.company_category)}`
                                : ""}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="text-slate-700">{j.contact_name ?? "—"}</div>
                            <div className="text-xs text-slate-500">{j.contact_title ?? ""}</div>
                          </td>
                          <td className="px-4 py-2.5">
                            {score != null ? (
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  score >= 80
                                    ? "bg-green-100 text-green-800"
                                    : score >= 60
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {score}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {j.channel === "linkedin" ? "💼 LinkedIn" : "✉ Email"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${jobStMeta.color}`}
                            >
                              {jobStMeta.label}
                            </span>
                            {ocMeta && (
                              <div className={`inline-block ml-1 px-2 py-0.5 rounded text-xs font-medium ${ocMeta.color}`}>
                                {ocMeta.emoji} {ocMeta.short}
                              </div>
                            )}
                            {j.outcome === "closed_won" && j.closed_value_eur && (
                              <div className="text-xs text-green-700 mt-0.5">
                                €{Number(j.closed_value_eur).toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            <div>{timeAgo(j.last_activity_at)}</div>
                            {j.next_action_at && (
                              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                                <Calendar className="h-3 w-3" /> {formatDate(j.next_action_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Link
                                href={
                                  j.status === "replied"
                                    ? `/team/${j.id}`
                                    : j.channel === "linkedin"
                                    ? `/admin/outreach/linkedin/${j.id}`
                                    : `/dashboard/leads/${j.lead_id}`
                                }
                                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                              >
                                Details <ExternalLink className="h-3 w-3" />
                              </Link>
                              {j.status !== "cancelled" && (
                                <select
                                  value=""
                                  disabled={reassigningId === j.id}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    if (v === "__POOL__") {
                                      if (confirm(`"${j.company_name}" zurück in den Pool?`)) {
                                        reassign(j.id, null, "Pool");
                                      }
                                    } else {
                                      const t = team.find((m) => m.user_id === v);
                                      if (t && confirm(`"${j.company_name}" an ${t.email} re-assignen?`)) {
                                        reassign(j.id, v, t.email ?? v.slice(0, 8));
                                      }
                                    }
                                    e.target.value = "";
                                  }}
                                  className="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white hover:border-slate-400"
                                  title="Re-assign"
                                >
                                  <option value="">↪ Re-assign</option>
                                  <option value="__POOL__">↪ Pool</option>
                                  {team
                                    .filter((m) => m.user_id !== id)
                                    .map((m) => (
                                      <option key={m.user_id} value={m.user_id}>
                                        {m.email ?? m.user_id.slice(0, 8)}
                                      </option>
                                    ))}
                                </select>
                              )}
                              {reassigningId === j.id && (
                                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : activeTab === "owned" ? (
            filteredOwned.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Dieser User hat keine eigenen Leads angelegt
                {statusFilter !== "all" ? ` mit Status "${statusBadge(LEAD_STATUS_LABEL, statusFilter).label}"` : ""}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left text-xs">
                      <th className="px-4 py-2 font-medium">Firma</th>
                      <th className="px-4 py-2 font-medium">Score</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Angelegt</th>
                      <th className="px-4 py-2 font-medium">LinkedIn</th>
                      <th className="px-4 py-2 font-medium">Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOwned.map((l) => {
                      const meta = statusBadge(LEAD_STATUS_LABEL, l.status);
                      return (
                        <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/dashboard/leads/${l.id}`}
                              className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                            >
                              {l.company_name ?? "—"}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {l.city ?? ""}
                              {l.category
                                ? ` · ${CATEGORY_EMOJI[l.category] ?? ""} ${getCategoryLabel(l.category)}`
                                : ""}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {l.total_score != null ? (
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  l.total_score >= 80
                                    ? "bg-green-100 text-green-800"
                                    : l.total_score >= 60
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {l.total_score}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {formatDate(l.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            {l.linkedin_url ? (
                              <a
                                href={l.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-700 hover:underline"
                              >
                                Profil ↗
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/dashboard/leads/${l.id}`}
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              Details <ExternalLink className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            // Activities Tab
            data && data.activities.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Keine Aktivitäten von diesem User.
              </div>
            ) : (
              <div className="divide-y">
                {data?.activities.map((a) => (
                  <Link
                    key={a.id}
                    href={`/team/${a.job_id}`}
                    className="flex items-start gap-3 p-3 hover:bg-slate-50 transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-700">
                        <span className="font-medium">{a.kind}</span>
                        {a.content && <span className="text-slate-600"> · {a.content}</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {timeAgo(a.created_at)} · job {a.job_id.slice(0, 8)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
