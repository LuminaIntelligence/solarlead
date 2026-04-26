"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  MessageSquare,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Phone,
  TrendingUp,
  Calendar,
  Trophy,
  XCircle,
  Settings,
  Inbox,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ───────────────────────────────────────────────────────────────────

type PipelineStage =
  | "interested"
  | "meeting_scheduled"
  | "offer_sent"
  | "closed_won"
  | "closed_lost"
  | null;

interface ReplyJob {
  id: string;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_title: string | null;
  reply_content: string | null;
  replied_at: string | null;
  pipeline_stage: PipelineStage;
  status: string;
  outreach_batches: { name: string } | null;
}

interface SyncResult {
  success?: boolean;
  error?: string;
  configured?: boolean;
  messagesChecked?: number;
  repliesFound?: number;
  optedOutFound?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES: { value: PipelineStage; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { value: null, label: "Neu", icon: <Inbox className="h-3.5 w-3.5" />, color: "text-slate-600", bg: "bg-slate-100" },
  { value: "interested", label: "Interessiert", icon: <TrendingUp className="h-3.5 w-3.5" />, color: "text-blue-700", bg: "bg-blue-100" },
  { value: "meeting_scheduled", label: "Termin", icon: <Calendar className="h-3.5 w-3.5" />, color: "text-purple-700", bg: "bg-purple-100" },
  { value: "offer_sent", label: "Angebot", icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-yellow-700", bg: "bg-yellow-100" },
  { value: "closed_won", label: "Gewonnen", icon: <Trophy className="h-3.5 w-3.5" />, color: "text-green-700", bg: "bg-green-100" },
  { value: "closed_lost", label: "Verloren", icon: <XCircle className="h-3.5 w-3.5" />, color: "text-slate-500", bg: "bg-slate-100" },
];

function getStageMeta(stage: PipelineStage) {
  return STAGES.find((s) => s.value === stage) ?? STAGES[0];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageDropdown({
  jobId,
  current,
  onChange,
}: {
  jobId: string;
  current: PipelineStage;
  onChange: (id: string, stage: PipelineStage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const meta = getStageMeta(current);

  async function selectStage(stage: PipelineStage) {
    setOpen(false);
    if (stage === current) return;
    setSaving(true);
    try {
      await fetch("/api/admin/outreach/pipeline-stage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, stage }),
      });
      onChange(jobId, stage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${meta.bg} ${meta.color} border-transparent hover:border-current/20`}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : meta.icon}
        {meta.label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[180px]">
            {STAGES.map((s) => (
              <button
                key={String(s.value)}
                onClick={() => selectStage(s.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 transition-colors ${
                  s.value === current ? "font-semibold" : ""
                }`}
              >
                <span className={`${s.bg} ${s.color} p-1 rounded-full`}>{s.icon}</span>
                <span className={s.color}>{s.label}</span>
                {s.value === current && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RepliesPage() {
  const [jobs, setJobs] = useState<ReplyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [imapConfigured, setImapConfigured] = useState<boolean | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | PipelineStage>("all");

  const fetchReplies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/outreach/replies");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReplies();
    // Check IMAP config
    fetch("/api/admin/outreach/sync-replies")
      .then((r) => r.json())
      .then((d) => setImapConfigured(d.configured ?? false))
      .catch(() => setImapConfigured(false));
  }, [fetchReplies]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/outreach/sync-replies", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
      if (data.repliesFound > 0 || data.optedOutFound > 0) {
        await fetchReplies();
      }
    } catch {
      setSyncResult({ error: "Netzwerkfehler" });
    } finally {
      setSyncing(false);
    }
  }

  function handleStageChange(jobId: string, stage: PipelineStage) {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, pipeline_stage: stage } : j))
    );
  }

  // Filter
  const filtered =
    activeFilter === "all"
      ? jobs
      : jobs.filter((j) => j.pipeline_stage === activeFilter);

  // Stage counts
  const counts = STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[String(s.value)] = jobs.filter((j) => j.pipeline_stage === s.value).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/admin/outreach" className="text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-green-600" />
              Antworten &amp; Pipeline
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {jobs.length} Antworten — Deals durch den Funnel führen
            </p>
          </div>
        </div>

        {/* Sync button */}
        <div className="flex items-center gap-3">
          {imapConfigured === false && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              <Settings className="h-3.5 w-3.5" />
              IMAP nicht konfiguriert
            </div>
          )}
          <Button
            onClick={handleSync}
            disabled={syncing || imapConfigured === false}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncing ? "Wird synchronisiert…" : "Jetzt synchronisieren"}
          </Button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div
          className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${
            syncResult.error
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-green-50 border-green-200 text-green-700"
          }`}
        >
          {syncResult.error ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          {syncResult.error ? (
            <span>{syncResult.error}</span>
          ) : (
            <span>
              Synchronisiert — {syncResult.messagesChecked} Nachrichten geprüft,{" "}
              <strong>{syncResult.repliesFound} neue Antworten</strong>
              {(syncResult.optedOutFound ?? 0) > 0 && `, ${syncResult.optedOutFound} Opt-outs`} gefunden.
            </span>
          )}
          <button onClick={() => setSyncResult(null)} className="ml-auto opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* IMAP setup hint */}
      {imapConfigured === false && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-4 px-5">
            <p className="text-sm font-semibold text-amber-800 mb-1">IMAP-Sync einrichten</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Damit Antworten automatisch erkannt werden, trage folgende Variablen in{" "}
              <code className="bg-amber-100 px-1 rounded">.env.local</code> ein:
            </p>
            <pre className="mt-2 text-xs bg-amber-100 rounded p-3 text-amber-900 leading-relaxed">
{`IMAP_HOST=imap.dein-anbieter.de
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=antworten@greenscout-ev.de
IMAP_PASS=dein-passwort`}
            </pre>
            <p className="text-xs text-amber-600 mt-2">
              Tipp: Richte in deiner E-Mail-Verwaltung eine Reply-To-Adresse ein, auf die Antworten eingehen.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pipeline filter tabs */}
      {jobs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              activeFilter === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            Alle ({jobs.length})
          </button>
          {STAGES.map((s) => {
            const count = counts[String(s.value)] ?? 0;
            if (count === 0) return null;
            const isActive = activeFilter === s.value;
            return (
              <button
                key={String(s.value)}
                onClick={() => setActiveFilter(s.value as "all" | PipelineStage)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  isActive
                    ? `${s.bg} ${s.color} border-current/20`
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}
              >
                {s.icon}
                {s.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <CardContent className="py-16 text-center">
            <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            {jobs.length === 0 ? (
              <>
                <p className="text-slate-500">Noch keine Antworten eingegangen.</p>
                <p className="text-slate-400 text-sm mt-1">
                  Klicke auf „Jetzt synchronisieren" um das Postfach zu prüfen.
                </p>
              </>
            ) : (
              <p className="text-slate-500">Keine Antworten in diesem Filter.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const batchName = job.outreach_batches?.name;
            const repliedAt = job.replied_at
              ? new Date(job.replied_at).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";

            return (
              <Card
                key={job.id}
                className={`bg-white border transition-colors ${
                  job.pipeline_stage === "closed_won"
                    ? "border-green-300"
                    : job.pipeline_stage === "closed_lost"
                    ? "border-slate-200 opacity-60"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3 min-w-0">
                      {/* Header row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-base font-bold text-slate-900 truncate">
                          {job.company_name}
                        </span>
                        {job.company_city && (
                          <span className="text-slate-500 text-sm">{job.company_city}</span>
                        )}
                        {batchName && (
                          <Badge className="bg-slate-100 text-slate-600 text-xs">{batchName}</Badge>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">
                          Geantwortet: {repliedAt}
                        </span>
                      </div>

                      {/* Contact row */}
                      <div className="flex items-center gap-6 text-sm flex-wrap">
                        <div>
                          <span className="text-slate-500">Kontakt: </span>
                          <span className="text-slate-900 font-medium">
                            {job.contact_name ?? "Unbekannt"}
                          </span>
                          {job.contact_title && (
                            <span className="text-slate-500"> · {job.contact_title}</span>
                          )}
                        </div>
                        {job.contact_email && (
                          <a
                            href={`mailto:${job.contact_email}`}
                            className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {job.contact_email}
                          </a>
                        )}
                      </div>

                      {/* Reply preview */}
                      {job.reply_content && (
                        <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
                          <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">
                            Antwort:
                          </p>
                          <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed line-clamp-3">
                            {job.reply_content}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right side actions */}
                    <div className="shrink-0 flex flex-col items-end gap-3">
                      <StageDropdown
                        jobId={job.id}
                        current={job.pipeline_stage}
                        onChange={handleStageChange}
                      />
                      <a
                        href={`tel:`}
                        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-green-700 transition-colors"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Anrufen
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
