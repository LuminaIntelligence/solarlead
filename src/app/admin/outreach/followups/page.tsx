"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  RotateCcw, Clock, CheckCircle, ArrowRight,
  Loader2, RefreshCw, Send, AlertCircle, CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FollowupJob {
  id: string;
  batch_id: string;
  batch_name: string;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_title: string | null;
  followup_scheduled_for: string | null;
  followup_status: string;
  followup_template: string;
  status: string;
  roof_area_m2: number | null;
}

interface FollowupData {
  due: FollowupJob[];
  upcoming: FollowupJob[];
  stats: { due: number; upcoming: number; sent_total: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function daysOverdue(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

const categoryLabels: Record<string, string> = {
  logistics: "Logistik", warehouse: "Lager", cold_storage: "Kühlhaus",
  supermarket: "Supermarkt", food_production: "Lebensmittel",
  manufacturing: "Fertigung", metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus", hotel: "Hotel",
  furniture_store: "Möbelhaus", hardware_store: "Baumarkt",
  shopping_center: "Einkaufszentrum",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FollowupQueuePage() {
  const [data, setData] = useState<FollowupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null); // batch_id currently sending
  const [sendingAll, setSendingAll] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({}); // batch_id → message

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/outreach/followups");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Send follow-ups for a single batch
  async function handleSendBatch(batchId: string, batchName: string, count: number) {
    if (!confirm(`${count} Follow-up${count !== 1 ? "s" : ""} für "${batchName}" senden?`)) return;
    setSending(batchId);
    try {
      const res = await fetch(`/api/admin/outreach/${batchId}/send-followups`, { method: "POST" });
      const d = await res.json();
      setResults((prev) => ({ ...prev, [batchId]: d.message ?? "Gesendet" }));
      await load();
    } finally {
      setSending(null);
    }
  }

  // Send all due follow-ups across all batches
  async function handleSendAll() {
    if (!data || data.due.length === 0) return;
    const batchIds = [...new Set(data.due.map((j) => j.batch_id))];
    if (!confirm(`Alle ${data.stats.due} fälligen Follow-ups über ${batchIds.length} Batch${batchIds.length !== 1 ? "es" : ""} senden?`)) return;
    setSendingAll(true);
    for (const batchId of batchIds) {
      try {
        const res = await fetch(`/api/admin/outreach/${batchId}/send-followups`, { method: "POST" });
        const d = await res.json();
        const name = data.due.find((j) => j.batch_id === batchId)?.batch_name ?? batchId;
        setResults((prev) => ({ ...prev, [batchId]: `${name}: ${d.message}` }));
      } catch {
        // continue with other batches
      }
    }
    setSendingAll(false);
    await load();
  }

  // Group due jobs by batch
  const dueByBatch = (data?.due ?? []).reduce<Record<string, FollowupJob[]>>((acc, job) => {
    if (!acc[job.batch_id]) acc[job.batch_id] = [];
    acc[job.batch_id].push(job);
    return acc;
  }, {});

  // Group upcoming by date
  const upcomingByDate = (data?.upcoming ?? []).reduce<Record<string, FollowupJob[]>>((acc, job) => {
    const d = job.followup_scheduled_for ?? "?";
    if (!acc[d]) acc[d] = [];
    acc[d].push(job);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <RotateCcw className="h-7 w-7 text-green-600" />
            Follow-up Queue
          </h1>
          <p className="text-slate-600 mt-1">
            Alle fälligen Nachfass-E-Mails auf einen Blick — über alle Batches
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-slate-300 text-slate-600"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {(data?.stats.due ?? 0) > 0 && (
            <Button
              onClick={handleSendAll}
              disabled={sendingAll}
              className="gap-2 text-[#1F3D2E] font-semibold"
              style={{ backgroundColor: "#B2D082" }}
            >
              {sendingAll ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sende alle…</>
              ) : (
                <><Send className="h-4 w-4" /> Alle {data?.stats.due} Follow-ups senden</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className={`bg-white border-2 ${(data?.stats.due ?? 0) > 0 ? "border-green-300" : "border-slate-200"}`}>
          <CardContent className="pt-4 pb-3">
            <div className={`text-3xl font-bold ${(data?.stats.due ?? 0) > 0 ? "text-green-600" : "text-slate-400"}`}>
              {loading ? "…" : (data?.stats.due ?? 0)}
            </div>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 text-green-500" />
              Heute fällig / überfällig
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4 pb-3">
            <div className="text-3xl font-bold text-slate-700">
              {loading ? "…" : (data?.stats.upcoming ?? 0)}
            </div>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              Nächste 14 Tage
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4 pb-3">
            <div className="text-3xl font-bold text-blue-600">
              {loading ? "…" : (data?.stats.sent_total ?? 0)}
            </div>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5 text-blue-400" />
              Follow-ups gesamt gesendet
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* ── DUE TODAY / OVERDUE ── */}
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${(data?.stats.due ?? 0) > 0 ? "bg-green-500" : "bg-slate-300"}`}>
                {data?.stats.due ?? 0}
              </span>
              Heute fällig / überfällig
            </h2>

            {Object.keys(dueByBatch).length === 0 ? (
              <Card className="bg-white border-slate-200">
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-700">Keine fälligen Follow-ups</p>
                  <p className="text-xs text-slate-500 mt-1">Alle Follow-ups sind auf dem neuesten Stand.</p>
                </CardContent>
              </Card>
            ) : (
              Object.entries(dueByBatch).map(([batchId, jobs]) => {
                const batchName = jobs[0].batch_name;
                const isSending = sending === batchId;
                const result = results[batchId];

                return (
                  <Card key={batchId} className="bg-white border-green-200 border">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-sm font-semibold text-slate-900">
                            {batchName}
                          </CardTitle>
                          <Badge className="bg-green-100 text-green-700 text-xs">
                            {jobs.length} fällig
                          </Badge>
                          <Badge className="bg-slate-100 text-slate-600 text-xs">
                            {jobs[0].followup_template === "followup" ? "Follow-up" : "Finale"}-Vorlage
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/outreach/${batchId}`}
                            className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                          >
                            Batch öffnen <ArrowRight className="h-3 w-3" />
                          </Link>
                          <Button
                            size="sm"
                            onClick={() => handleSendBatch(batchId, batchName, jobs.length)}
                            disabled={isSending}
                            className="h-7 text-xs gap-1 text-[#1F3D2E] font-semibold"
                            style={{ backgroundColor: "#B2D082" }}
                          >
                            {isSending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            {jobs.length} senden
                          </Button>
                        </div>
                      </div>
                      {result && (
                        <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 mt-1">
                          ✓ {result}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-slate-100 bg-slate-50 text-left">
                              <th className="px-4 py-2 text-xs font-medium text-slate-500">Unternehmen</th>
                              <th className="px-4 py-2 text-xs font-medium text-slate-500">Kontakt</th>
                              <th className="px-4 py-2 text-xs font-medium text-slate-500">E-Mail</th>
                              <th className="px-4 py-2 text-xs font-medium text-slate-500">Fällig seit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jobs.map((job) => {
                              const overdue = job.followup_scheduled_for
                                ? daysOverdue(job.followup_scheduled_for)
                                : 0;
                              return (
                                <tr key={job.id} className="border-t border-slate-100 hover:bg-slate-50">
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-slate-900">{job.company_name}</div>
                                    <div className="text-xs text-slate-400">
                                      {job.company_city}
                                      {job.company_category && ` · ${categoryLabels[job.company_category] ?? job.company_category}`}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="text-slate-700">{job.contact_name ?? "—"}</div>
                                    <div className="text-xs text-slate-400">{job.contact_title ?? ""}</div>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">
                                    {job.contact_email ?? "—"}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {overdue === 0 ? (
                                      <span className="text-xs font-medium text-green-600">Heute</span>
                                    ) : (
                                      <span className="text-xs font-medium text-amber-600">
                                        {overdue} Tag{overdue !== 1 ? "en" : ""} überfällig
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* ── UPCOMING ── */}
          {Object.keys(upcomingByDate).length > 0 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-slate-400" />
                Nächste 14 Tage
              </h2>

              <Card className="bg-white border-slate-200">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                          <th className="px-4 py-3 text-xs font-medium text-slate-500">Datum</th>
                          <th className="px-4 py-3 text-xs font-medium text-slate-500">Unternehmen</th>
                          <th className="px-4 py-3 text-xs font-medium text-slate-500">Batch</th>
                          <th className="px-4 py-3 text-xs font-medium text-slate-500">In</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(upcomingByDate)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .flatMap(([date, jobs]) =>
                            jobs.map((job) => {
                              const until = daysUntil(date);
                              return (
                                <tr key={job.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                  <td className="px-4 py-2.5 text-xs text-slate-600 font-medium whitespace-nowrap">
                                    {formatDate(date)}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-slate-900 text-sm">{job.company_name}</div>
                                    <div className="text-xs text-slate-400">{job.company_city}</div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <Link
                                      href={`/admin/outreach/${job.batch_id}`}
                                      className="text-xs text-blue-600 hover:underline"
                                    >
                                      {job.batch_name}
                                    </Link>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-slate-500">
                                    {until === 1 ? "morgen" : `${until} Tagen`}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Empty state — no follow-up batches at all */}
          {data && data.stats.due === 0 && data.stats.upcoming === 0 && data.stats.sent_total === 0 && (
            <Card className="bg-white border-slate-200">
              <CardContent className="py-16 text-center">
                <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-700">Noch keine Follow-up-Batches</p>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Aktiviere Follow-ups beim Erstellen eines neuen Batches.
                </p>
                <Button asChild variant="outline" size="sm" className="border-slate-300 text-slate-700">
                  <Link href="/admin/outreach/new">Neuen Batch erstellen</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
