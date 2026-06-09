"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, ExternalLink, Download, UserCheck,
  Calendar, MessageSquare, RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { OUTCOME_OPTIONS, outcomeMeta } from "@/lib/constants/reply-outcomes";
import { getCategoryLabel, CATEGORY_EMOJI } from "@/lib/constants/categories";
import type { ReplyOutcome } from "@/types/database";

interface SpecialistJob {
  id: string;
  lead_id: string;
  status: string;
  channel: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  outcome: ReplyOutcome | null;
  outcome_at: string | null;
  replied_at: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  closed_value_eur: number | null;
  solar_lead_mass: { total_score: number | null; status: string | null } | null;
}

interface ApiResponse {
  specialist: {
    user_id: string;
    email: string | null;
    role: string;
  };
  jobs: SpecialistJob[];
  counts: Record<string, number>;
  total_won_value_eur: number;
  activities: Array<{
    id: string;
    job_id: string;
    kind: string;
    content: string | null;
    created_at: string;
  }>;
}

type GroupKey = "active" | "won" | "lost" | "no_interest" | "all";

const GROUP_DEFS: Array<{
  key: GroupKey;
  label: string;
  outcomes: ReplyOutcome[];
  color: string;
}> = [
  {
    key: "active",
    label: "Aktiv",
    outcomes: ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"],
    color: "bg-blue-100 text-blue-800",
  },
  {
    key: "won",
    label: "Won",
    outcomes: ["closed_won"],
    color: "bg-green-100 text-green-800",
  },
  {
    key: "lost",
    label: "Lost",
    outcomes: ["closed_lost"],
    color: "bg-red-100 text-red-800",
  },
  {
    key: "no_interest",
    label: "Kein Interesse",
    outcomes: ["not_interested"],
    color: "bg-slate-100 text-slate-700",
  },
  {
    key: "all",
    label: "Alle",
    outcomes: [],
    color: "bg-slate-900 text-white",
  },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "gerade eben";
  if (ms < 3600_000) return `vor ${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `vor ${Math.floor(ms / 3600_000)} h`;
  return `vor ${Math.floor(ms / 86400_000)} Tagen`;
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
  const [activeGroup, setActiveGroup] = useState<GroupKey>("active");
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

  // Team-Liste für Re-Assign-Dropdown
  useEffect(() => {
    fetch("/api/admin/reply-management/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.team) setTeam(d.team);
      })
      .catch(() => {});
  }, []);

  const filteredJobs = (() => {
    if (!data) return [];
    if (activeGroup === "all") return data.jobs;
    const group = GROUP_DEFS.find((g) => g.key === activeGroup);
    if (!group) return data.jobs;
    return data.jobs.filter((j) => {
      const oc = j.outcome ?? "new";
      return group.outcomes.includes(oc);
    });
  })();

  function countForGroup(g: GroupKey): number {
    if (!data) return 0;
    if (g === "all") return data.jobs.length;
    const def = GROUP_DEFS.find((d) => d.key === g);
    if (!def) return 0;
    return def.outcomes.reduce((sum, oc) => sum + (data.counts[oc] ?? 0), 0);
  }

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
    const headers = [
      "company_name", "city", "category", "score", "outcome",
      "contact_name", "contact_title", "last_activity_at", "next_action_at",
      "closed_value_eur", "lead_id", "job_id",
    ];
    const lines = [
      headers.join(","),
      ...filteredJobs.map((j) =>
        [
          JSON.stringify(j.company_name ?? ""),
          JSON.stringify(j.company_city ?? ""),
          JSON.stringify(j.company_category ?? ""),
          j.solar_lead_mass?.total_score ?? "",
          j.outcome ?? "new",
          JSON.stringify(j.contact_name ?? ""),
          JSON.stringify(j.contact_title ?? ""),
          j.last_activity_at ?? "",
          j.next_action_at ?? "",
          j.closed_value_eur ?? "",
          j.lead_id,
          j.id,
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `specialist-${data.specialist.email ?? id}-${new Date().toISOString().slice(0, 10)}.csv`;
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
            Pipeline & Aktivitäten dieses Reply-Specialists.
            {data?.specialist.role && data.specialist.role !== "reply_specialist" && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {data.specialist.role}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && filteredJobs.length > 0 && (
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
            <div className="text-xs uppercase text-slate-500 font-medium">Gesamt zugewiesen</div>
            <div className="text-2xl font-bold mt-1">{data?.jobs.length ?? "—"}</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-blue-700 font-medium">Aktiv</div>
            <div className="text-2xl font-bold mt-1 text-blue-900">{countForGroup("active")}</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-green-700 font-medium">Won</div>
            <div className="text-2xl font-bold mt-1 text-green-900">{countForGroup("won")}</div>
            {data && data.total_won_value_eur > 0 && (
              <div className="text-xs text-green-700 mt-0.5">
                €{data.total_won_value_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Lost / Kein Interesse</div>
            <div className="text-2xl font-bold mt-1">
              {countForGroup("lost") + countForGroup("no_interest")}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Group-Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {GROUP_DEFS.map((g) => {
          const active = activeGroup === g.key;
          const count = countForGroup(g.key);
          return (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {g.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Jobs-Tabelle */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {filteredJobs.length} Leads
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Keine Leads in „{GROUP_DEFS.find((g) => g.key === activeGroup)?.label}".
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Firma</th>
                    <th className="px-4 py-2 font-medium">Kontakt</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium">Letzte Aktivität</th>
                    <th className="px-4 py-2 font-medium">Nächste Aktion</th>
                    <th className="px-4 py-2 font-medium">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((j) => {
                    const oc = j.outcome ?? "new";
                    const meta = outcomeMeta(oc);
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
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}
                          >
                            {meta.emoji} {meta.short}
                          </span>
                          {oc === "closed_won" && j.closed_value_eur && (
                            <div className="text-xs text-green-700 mt-0.5">
                              €{Number(j.closed_value_eur).toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {timeAgo(j.last_activity_at)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {j.next_action_at ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(j.next_action_at)}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/team/${j.id}`}
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              Details <ExternalLink className="h-3 w-3" />
                            </Link>
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
                                  if (
                                    t &&
                                    confirm(`"${j.company_name}" an ${t.email} re-assignen?`)
                                  ) {
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
          )}
        </CardContent>
      </Card>

      {/* Activity-Timeline */}
      {data && data.activities.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-slate-500" />
              Letzte Aktivitäten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.activities.map((a) => (
                <Link
                  key={a.id}
                  href={`/team/${a.job_id}`}
                  className="flex items-start gap-3 p-2 -mx-2 rounded hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-700">
                      <span className="font-medium">{a.kind}</span>
                      {a.content && <span className="text-slate-600"> · {a.content}</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {timeAgo(a.created_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
