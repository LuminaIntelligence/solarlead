"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, Pause, Play, RefreshCw,
  Mail, CheckCircle, Clock, AlertCircle, XCircle, MessageSquare
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OutreachBatch, OutreachJob, OutreachJobStatus, OutreachBatchStatus } from "@/types/database";

const JOB_STATUS_COLORS: Record<OutreachJobStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  opened: "bg-yellow-100 text-yellow-700",
  replied: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  opted_out: "bg-gray-100 text-gray-600",
};

const JOB_STATUS_LABELS: Record<OutreachJobStatus, string> = {
  pending: "Ausstehend",
  sent: "Gesendet",
  opened: "Geöffnet",
  replied: "Geantwortet",
  bounced: "Bounced",
  opted_out: "Abgemeldet",
};

const BATCH_STATUS_COLORS: Record<OutreachBatchStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [batch, setBatch] = useState<OutreachBatch | null>(null);
  const [jobs, setJobs] = useState<OutreachJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; message?: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/outreach/${id}`);
    if (res.ok) {
      const data = await res.json();
      setBatch(data.batch);
      setJobs(data.jobs);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const todayJobs = jobs.filter((j) => j.scheduled_for === today);
  const todayPending = todayJobs.filter((j) => j.status === "pending");
  const totalReplied = jobs.filter((j) => j.status === "replied").length;
  const totalSent = jobs.filter((j) => j.status === "sent" || j.status === "opened" || j.status === "replied").length;

  const handleSend = async () => {
    if (!confirm(`${todayPending.length} E-Mails jetzt senden?`)) return;
    setSending(true);
    setSendResult(null);
    const res = await fetch(`/api/admin/outreach/${id}/send`, { method: "POST" });
    const data = await res.json();
    setSendResult(data);
    setSending(false);
    load();
  };

  const handleStatusChange = async (status: OutreachBatchStatus) => {
    await fetch(`/api/admin/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-slate-500">Laden...</div>;
  }

  if (!batch) {
    return (
      <div className="text-center py-24">
        <p className="text-slate-500">Batch nicht gefunden.</p>
        <Link href="/admin/outreach" className="text-blue-600 hover:underline mt-2 block">← Zurück</Link>
      </div>
    );
  }

  // Group jobs by date
  const jobsByDate = jobs.reduce<Record<string, OutreachJob[]>>((acc, job) => {
    const date = job.scheduled_for ?? "Kein Datum";
    if (!acc[date]) acc[date] = [];
    acc[date].push(job);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/outreach" className="text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{batch.name}</h1>
            <p className="text-slate-600 text-sm mt-0.5">{batch.description ?? "Kein Beschreibungstext"}</p>
          </div>
          <Badge className={BATCH_STATUS_COLORS[batch.status]}>
            {batch.status === "draft" ? "Entwurf" : batch.status === "active" ? "Aktiv" : batch.status === "paused" ? "Pausiert" : "Abgeschlossen"}
          </Badge>
        </div>
        <div className="flex gap-2">
          {batch.status === "draft" && (
            <Button onClick={() => handleStatusChange("active")} className="bg-green-600 hover:bg-green-700 gap-2">
              <Play className="h-4 w-4" /> Aktivieren
            </Button>
          )}
          {batch.status === "active" && (
            <Button onClick={() => handleStatusChange("paused")} variant="outline" className="border-slate-300 text-slate-700 gap-2">
              <Pause className="h-4 w-4" /> Pausieren
            </Button>
          )}
          {batch.status === "paused" && (
            <Button onClick={() => handleStatusChange("active")} className="bg-green-600 hover:bg-green-700 gap-2">
              <Play className="h-4 w-4" /> Fortsetzen
            </Button>
          )}
          <Button onClick={load} variant="ghost" size="sm" className="text-slate-500">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-slate-900">{batch.total_leads}</div>
            <div className="text-sm text-slate-500 mt-1">Leads gesamt</div>
          </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-blue-600">{totalSent}</div>
            <div className="text-sm text-slate-500 mt-1">E-Mails gesendet</div>
          </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-green-600">{totalReplied}</div>
            <div className="text-sm text-slate-500 mt-1">Antworten</div>
          </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
          <CardContent className="pt-4">
            <div className="text-3xl font-bold text-yellow-600">
              {totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0}%
            </div>
            <div className="text-sm text-slate-500 mt-1">Reply Rate</div>
          </CardContent>
        </Card>
      </div>

      {/* Today's Send Box */}
      {batch.status === "active" && (
        <Card className="bg-white border-green-300 border">
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Send className="h-5 w-5 text-green-600" />
              Heute senden — {today}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-slate-600">
                <span className="text-slate-900 font-bold text-xl">{todayPending.length}</span>
                {" "}ausstehend
              </span>
              <span className="text-slate-600">
                <span className="text-blue-600 font-bold text-xl">{todayJobs.filter(j => j.status === "sent").length}</span>
                {" "}bereits gesendet
              </span>
              <span className="text-slate-600">
                <span className="text-slate-500 font-bold">{batch.daily_limit}/Tag</span>
                {" "}Limit
              </span>
            </div>

            {sendResult && (
              <div className={`rounded-lg px-4 py-3 text-sm ${sendResult.failed === 0 ? "bg-green-50 border border-green-200 text-green-700" : "bg-yellow-50 border border-yellow-200 text-yellow-700"}`}>
                {sendResult.message ?? `✓ ${sendResult.sent} gesendet${sendResult.failed > 0 ? `, ${sendResult.failed} fehlgeschlagen` : ""}`}
              </div>
            )}

            <Button
              onClick={handleSend}
              disabled={sending || todayPending.length === 0}
              className="bg-green-600 hover:bg-green-700 gap-2 disabled:opacity-50"
            >
              {sending ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Sende...</>
              ) : (
                <><Send className="h-4 w-4" /> {todayPending.length} E-Mails jetzt senden</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Jobs by date */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">Alle Jobs ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(jobsByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, dateJobs]) => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-sm font-semibold ${date === today ? "text-green-600" : "text-slate-700"}`}>
                  {date === today ? "📅 Heute" : date}
                </span>
                <span className="text-xs text-slate-500">{dateJobs.length} Jobs</span>
                <div className="flex gap-1">
                  {Object.entries(
                    dateJobs.reduce<Record<string, number>>((acc, j) => {
                      acc[j.status] = (acc[j.status] ?? 0) + 1;
                      return acc;
                    }, {})
                  ).map(([status, count]) => (
                    <span key={status} className={`text-xs px-2 py-0.5 rounded-full ${JOB_STATUS_COLORS[status as OutreachJobStatus]}`}>
                      {count} {JOB_STATUS_LABELS[status as OutreachJobStatus]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left bg-slate-50">
                      <th className="px-4 py-2 text-slate-500 font-medium">Unternehmen</th>
                      <th className="px-4 py-2 text-slate-500 font-medium">Kontakt</th>
                      <th className="px-4 py-2 text-slate-500 font-medium">E-Mail</th>
                      <th className="px-4 py-2 text-slate-500 font-medium">Status</th>
                      <th className="px-4 py-2 text-slate-500 font-medium">Gesendet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateJobs.map((job) => (
                      <tr key={job.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{job.company_name}</div>
                          <div className="text-xs text-slate-500">{job.company_city}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-700">{job.contact_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{job.contact_title ?? ""}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{job.contact_email ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={JOB_STATUS_COLORS[job.status]}>
                            {JOB_STATUS_LABELS[job.status]}
                          </Badge>
                          {job.status === "replied" && (
                            <MessageSquare className="inline h-3.5 w-3.5 text-green-600 ml-1" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {job.sent_at ? new Date(job.sent_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
