"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, Pause, Play, RefreshCw,
  Mail, MessageSquare, Eye, X, Loader2, RotateCcw, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OutreachBatch, OutreachJob, OutreachJobStatus, OutreachBatchStatus } from "@/types/database";

// ─── Status maps ─────────────────────────────────────────────────────────────

const JOB_STATUS_COLORS: Record<OutreachJobStatus, string> = {
  pending:   "bg-slate-100 text-slate-700",
  sent:      "bg-blue-100 text-blue-700",
  opened:    "bg-yellow-100 text-yellow-700",
  replied:   "bg-green-100 text-green-700",
  bounced:   "bg-red-100 text-red-700",
  opted_out: "bg-gray-100 text-gray-600",
};

const JOB_STATUS_LABELS: Record<OutreachJobStatus, string> = {
  pending:   "Ausstehend",
  sent:      "Gesendet",
  opened:    "Geöffnet",
  replied:   "Geantwortet",
  bounced:   "Bounced",
  opted_out: "Abgemeldet",
};

const BATCH_STATUS_COLORS: Record<OutreachBatchStatus, string> = {
  draft:     "bg-slate-100 text-slate-700",
  active:    "bg-green-100 text-green-700",
  paused:    "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

const BATCH_STATUS_LABELS: Record<OutreachBatchStatus, string> = {
  draft:     "Entwurf",
  active:    "Aktiv",
  paused:    "Pausiert",
  completed: "Abgeschlossen",
};

// ─── E-Mail Preview Modal ─────────────────────────────────────────────────────

interface PreviewData {
  subject: string;
  html: string;
  text: string;
  to: string | null;
  contact_name: string | null;
  company_name: string | null;
  template_type: string;
}

function EmailPreviewModal({
  batchId,
  job,
  onClose,
}: {
  batchId: string;
  job: OutreachJob;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"html" | "text">("html");

  // Test send state
  const [showTestSend, setShowTestSend] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/outreach/${batchId}/preview?job_id=${job.id}`)
      .then((r) => r.json())
      .then((data) => { setPreview(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [batchId, job.id]);

  async function handleTestSend() {
    if (!testEmail.trim() || !preview) return;
    setTestSending(true);
    setTestResult(null);
    try {
      // Reuse the discovery test-email endpoint pattern but for outreach
      const res = await fetch(`/api/admin/outreach/${batchId}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail.trim(), job_id: job.id }),
      });
      const data = await res.json();
      setTestResult({ ok: res.ok, message: data.message ?? data.error ?? "Unbekannt" });
    } catch {
      setTestResult({ ok: false, message: "Netzwerkfehler" });
    } finally {
      setTestSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#1F3D2E]" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                E-Mail Vorschau
              </h2>
              <p className="text-xs text-slate-500">
                {job.company_name} · {job.contact_email}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : !preview ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            Vorschau konnte nicht geladen werden.
          </div>
        ) : (
          <>
            {/* Subject line */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 shrink-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-slate-500 w-14 shrink-0">Betreff:</span>
                <span className="text-sm font-medium text-slate-900">{preview.subject}</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-xs font-medium text-slate-500 w-14 shrink-0">An:</span>
                <span className="text-sm text-slate-600">{preview.to ?? "—"}</span>
              </div>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 px-5 pt-3 shrink-0">
              <button
                onClick={() => setTab("html")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === "html"
                    ? "bg-[#1F3D2E] text-white"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                HTML-Vorschau
              </button>
              <button
                onClick={() => setTab("text")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === "text"
                    ? "bg-[#1F3D2E] text-white"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                Plaintext
              </button>
            </div>

            {/* Email body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {tab === "html" ? (
                <div
                  className="border border-slate-200 rounded-lg overflow-hidden"
                  style={{ minHeight: 300 }}
                >
                  <iframe
                    srcDoc={preview.html}
                    className="w-full"
                    style={{ height: 420, border: "none" }}
                    title="E-Mail Vorschau"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : (
                <pre className="text-xs text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">
                  {preview.text}
                </pre>
              )}
            </div>

            {/* Test send section */}
            <div className="px-5 py-4 border-t border-slate-200 shrink-0">
              {!showTestSend ? (
                <button
                  onClick={() => setShowTestSend(true)}
                  className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" />
                  Test-E-Mail an mich senden
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="test@example.de"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleTestSend()}
                      className="text-sm border-slate-300"
                    />
                    <Button
                      onClick={handleTestSend}
                      disabled={testSending || !testEmail.trim()}
                      size="sm"
                      className="shrink-0 text-[#1F3D2E] font-semibold"
                      style={{ backgroundColor: "#B2D082" }}
                    >
                      {testSending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Senden"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowTestSend(false); setTestResult(null); }}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {testResult && (
                    <p className={`text-xs ${testResult.ok ? "text-green-700" : "text-red-600"}`}>
                      {testResult.ok ? "✓ " : "✕ "}{testResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [batch, setBatch] = useState<OutreachBatch | null>(null);
  const [jobs, setJobs] = useState<OutreachJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; message?: string } | null>(null);
  const [previewJob, setPreviewJob] = useState<OutreachJob | null>(null);
  const [sendingFollowups, setSendingFollowups] = useState(false);
  const [followupResult, setFollowupResult] = useState<{ sent: number; skipped: number; message: string } | null>(null);

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
  const totalSent = jobs.filter((j) => ["sent", "opened", "replied"].includes(j.status)).length;

  // Follow-up stats
  const followupDueToday = jobs.filter(
    (j) =>
      j.followup_scheduled_for != null &&
      j.followup_scheduled_for <= today &&
      j.followup_status === "pending" &&
      j.status !== "pending" &&
      j.status !== "replied" &&
      j.status !== "bounced" &&
      j.status !== "opted_out"
  );
  const followupSent = jobs.filter((j) => j.followup_status === "sent").length;
  const followupSkipped = jobs.filter((j) => j.followup_status === "skipped").length;

  const handleSendFollowups = async () => {
    if (!confirm(`${followupDueToday.length} Follow-up-E-Mails jetzt senden?`)) return;
    setSendingFollowups(true);
    setFollowupResult(null);
    const res = await fetch(`/api/admin/outreach/${id}/send-followups`, { method: "POST" });
    const data = await res.json();
    setFollowupResult(data);
    setSendingFollowups(false);
    load();
  };

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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
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
            {BATCH_STATUS_LABELS[batch.status]}
          </Badge>
        </div>
        <div className="flex gap-2">
          {/* Test E-Mail Button — always visible */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Open preview for first pending job
              const firstJob = jobs.find((j) => j.status === "pending") ?? jobs[0];
              if (firstJob) setPreviewJob(firstJob);
            }}
            className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50 gap-1.5"
          >
            <Eye className="h-4 w-4" />
            E-Mail Vorschau
          </Button>

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
        <Card className="bg-white border border-green-300">
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
                <><Loader2 className="h-4 w-4 animate-spin" /> Sende...</>
              ) : (
                <><Send className="h-4 w-4" /> {todayPending.length} E-Mails jetzt senden</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Follow-up Box */}
      {batch.followup_enabled && (
        <Card className={`bg-white border-2 ${followupDueToday.length > 0 ? "border-green-300" : "border-slate-200"}`}>
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-green-600" />
              Follow-up Automatisierung
              <span className="ml-auto text-xs font-normal text-slate-500 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Nach {batch.followup_days} Tagen · {batch.followup_template === "followup" ? "Follow-up" : "Finale"}-Vorlage
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-slate-600">
                <span className={`font-bold text-xl ${followupDueToday.length > 0 ? "text-green-600" : "text-slate-900"}`}>
                  {followupDueToday.length}
                </span>
                {" "}heute fällig
              </span>
              <span className="text-slate-600">
                <span className="text-blue-600 font-bold text-xl">{followupSent}</span>
                {" "}gesendet
              </span>
              <span className="text-slate-600">
                <span className="text-slate-500 font-bold">{followupSkipped}</span>
                {" "}übersprungen (bereits geantwortet)
              </span>
            </div>

            {followupResult && (
              <div className={`rounded-lg px-4 py-3 text-sm ${followupResult.sent > 0 ? "bg-green-50 border border-green-200 text-green-700" : "bg-slate-50 border border-slate-200 text-slate-600"}`}>
                {followupResult.message}
              </div>
            )}

            <Button
              onClick={handleSendFollowups}
              disabled={sendingFollowups || followupDueToday.length === 0}
              className="gap-2 disabled:opacity-50 text-[#1F3D2E] font-semibold"
              style={{ backgroundColor: "#B2D082" }}
            >
              {sendingFollowups ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sende Follow-ups...</>
              ) : (
                <><RotateCcw className="h-4 w-4" /> {followupDueToday.length} Follow-ups jetzt senden</>
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
                      {batch.followup_enabled && (
                        <th className="px-4 py-2 text-slate-500 font-medium">Follow-up</th>
                      )}
                      <th className="px-4 py-2 text-slate-500 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateJobs.map((job) => (
                      <tr key={job.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50 group">
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
                          {job.sent_at
                            ? new Date(job.sent_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </td>
                        {batch.followup_enabled && (
                          <td className="px-4 py-3 text-xs">
                            {job.followup_status === "sent" ? (
                              <span className="text-green-600 font-medium">✓ Gesendet</span>
                            ) : job.followup_status === "skipped" ? (
                              <span className="text-slate-400">Übersprungen</span>
                            ) : job.followup_status === "cancelled" ? (
                              <span className="text-slate-400">Abgebrochen</span>
                            ) : job.followup_scheduled_for ? (
                              <span className={job.followup_scheduled_for <= today ? "text-amber-600 font-medium" : "text-slate-400"}>
                                {job.followup_scheduled_for <= today ? "⚡ Fällig" : job.followup_scheduled_for}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setPreviewJob(job)}
                            title="E-Mail Vorschau"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-900"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
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

      {/* E-Mail Preview Modal */}
      {previewJob && (
        <EmailPreviewModal
          batchId={id}
          job={previewJob}
          onClose={() => setPreviewJob(null)}
        />
      )}
    </div>
  );
}
