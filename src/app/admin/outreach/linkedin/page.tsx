"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Linkedin, Loader2, ExternalLink, Send, MessageCircle, Inbox,
  AlertCircle, ArrowRight, CheckCircle2, Plus, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface LinkedInJob {
  id: string;
  batch_id: string;
  status: string;
  contact_name: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  linkedin_url: string | null;
  linkedin_sent_at: string | null;
  linkedin_message: string | null;
  replied_at: string | null;
  outcome: string | null;
  scheduled_for: string | null;
  outreach_batches: { name: string } | null;
}

interface ApiResponse {
  jobs: LinkedInJob[];
  counts: Record<string, number>;
  today_sent_count: number;
  stale_sent_count: number;
}

const STATUS_TABS: Array<{ key: string; label: string; color: string }> = [
  { key: "pending", label: "Offen", color: "bg-amber-100 text-amber-800" },
  { key: "sent",    label: "Gesendet", color: "bg-blue-100 text-blue-800" },
  { key: "replied", label: "Beantwortet", color: "bg-green-100 text-green-800" },
  { key: "expired", label: "Abgelaufen (14d)", color: "bg-slate-100 text-slate-600" },
];

const SOFT_DAILY_LIMIT = 25; // LinkedIn-Limit Personal Profile ist 20-30/Tag

export default function LinkedInOutreachPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<string>("pending");

  // Pool-Erstellungs-Form
  const [poolMinScore, setPoolMinScore] = useState(70);
  const [poolMaxScore, setPoolMaxScore] = useState(100);
  const [poolLimit, setPoolLimit] = useState(200);
  const [poolCreating, setPoolCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/outreach/linkedin?status=${activeStatus}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPool() {
    if (!confirm(
      `${poolMinScore}-${poolMaxScore} Score-Bereich, max ${poolLimit} Leads — alle bekommen einen LinkedIn-Outreach-Job. Bestehende Jobs werden nicht dupliziert. Fortfahren?`
    )) return;
    setPoolCreating(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/pool-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_score: poolMinScore,
          max_score: poolMaxScore,
          limit: poolLimit,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      const emailNote =
        d.email_pending_cancelled || d.email_followups_stopped
          ? ` · ${d.email_pending_cancelled} Email-Jobs storniert, ${d.email_followups_stopped} Follow-ups gestoppt`
          : "";
      toast({
        title: `${d.created} LinkedIn-Jobs erstellt`,
        description:
          `${d.batch_name} · ${d.skipped_existing_job} schon vorhandene übersprungen` +
          emailNote,
      });
      await load();
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setPoolCreating(false);
    }
  }

  async function syncEmailJobs() {
    if (!confirm(
      "Alle Leads die bereits in der LinkedIn-Pipeline sind werden aus offenen Email-Jobs entfernt (storniert) und ihre Follow-ups werden gestoppt. Fortfahren?"
    )) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/sync-email-jobs", {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: `Sync abgeschlossen`,
        description: `${d.leads_in_linkedin_pipeline} LinkedIn-Leads geprüft · ${d.email_pending_cancelled} pending Email-Jobs storniert · ${d.email_followups_stopped} Follow-ups gestoppt`,
      });
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Linkedin className="h-7 w-7 text-blue-700" />
            LinkedIn-Outreach
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Persönliche InMails an Leads mit LinkedIn-Profil. Manuell-assistiert:
            Template + Profil-Link, du sendest über LinkedIn, markierst hier „Gesendet".
          </p>
        </div>
        <Link
          href="/admin/outreach/linkedin/templates"
          className="text-sm text-blue-700 hover:underline inline-flex items-center gap-1"
        >
          Templates verwalten <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Stale-Reminder: gesendete InMails ≥1 Tag ohne Antwort-Vermerk */}
      {data && data.stale_sent_count > 0 && activeStatus !== "sent" && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                <strong>{data.stale_sent_count}</strong> InMails warten ≥1 Tag
                auf Antwort-Check — kurz auf LinkedIn nachschauen?
              </span>
            </div>
            <button
              onClick={() => setActiveStatus("sent")}
              className="text-xs font-medium text-amber-900 hover:underline"
            >
              → Anzeigen
            </button>
          </CardContent>
        </Card>
      )}

      {/* Daily Rate-Limit-Hinweis */}
      {data && data.today_sent_count >= SOFT_DAILY_LIMIT * 0.8 && (
        <Card
          className={
            data.today_sent_count >= SOFT_DAILY_LIMIT
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }
        >
          <CardContent className="py-3 px-4 flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Heute schon <strong>{data.today_sent_count}</strong> InMails gesendet.
              LinkedIn-Limit Personal Profile liegt bei ~{SOFT_DAILY_LIMIT}/Tag.
              {data.today_sent_count >= SOFT_DAILY_LIMIT
                ? " Weitere Sends könnten Account-Warnungen auslösen."
                : " Vorsichtig dosieren."}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Pool-Erstellung (wenn keine Jobs vorhanden) */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-700" />
            Pool füllen aus vorhandenen Leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-600 mb-3">
            Erstellt LinkedIn-Outreach-Jobs für alle Leads im Score-Range die schon
            eine persönliche LinkedIn-URL haben (über Apollo/Impressum/Google-CSE
            gefunden). Du wählst dann pro Lead manuell ob du eine InMail schicken willst.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score min
              </label>
              <input
                type="number"
                value={poolMinScore}
                onChange={(e) => setPoolMinScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score max
              </label>
              <input
                type="number"
                value={poolMaxScore}
                onChange={(e) => setPoolMaxScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Max Leads
              </label>
              <input
                type="number"
                value={poolLimit}
                onChange={(e) => setPoolLimit(Number(e.target.value))}
                min={1}
                max={2000}
                className="w-24 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <Button onClick={createPool} disabled={poolCreating}>
              {poolCreating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Pool erstellen
            </Button>
          </div>
          <div className="mt-4 pt-3 border-t border-blue-200">
            <p className="text-xs text-slate-600 mb-2">
              <strong>Email-Sync für Bestand:</strong> Falls du den Pool schon vor
              dem 01.06. erstellt hast, laufen ggf. noch parallele Email-Jobs für
              dieselben Leads. Klick stoppt diese rückwirkend.
            </p>
            <Button onClick={syncEmailJobs} disabled={syncing} variant="outline" size="sm">
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Email-Jobs für LinkedIn-Leads stoppen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Status-Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_TABS.map((t) => {
          const count = data?.counts[t.key] ?? 0;
          const active = activeStatus === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveStatus(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Job-Liste */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !data || data.jobs.length === 0 ? (
            <div className="py-16 text-center">
              <Linkedin className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                Keine LinkedIn-Jobs mit Status „{activeStatus}".
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Leads mit LinkedIn-URL werden beim Batch-Erstellen automatisch hierher geroutet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Lead</th>
                    <th className="px-4 py-2 font-medium">Kontakt</th>
                    <th className="px-4 py-2 font-medium">Batch</th>
                    <th className="px-4 py-2 font-medium">LinkedIn</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => {
                    const isPending = j.status === "pending";
                    const isReplied = j.status === "replied";
                    return (
                      <tr key={j.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">
                            {j.company_name ?? "—"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {j.company_city ?? ""}
                            {j.company_category ? ` · ${j.company_category}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-slate-700">{j.contact_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{j.contact_title ?? ""}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {j.outreach_batches?.name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {j.linkedin_url ? (
                            <a
                              href={j.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              Profil <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">keine URL</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {isPending && (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                              Offen
                            </Badge>
                          )}
                          {j.status === "sent" && (
                            <div>
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                <Send className="h-3 w-3 mr-1 inline" /> Gesendet
                              </Badge>
                              {j.linkedin_sent_at && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {new Date(j.linkedin_sent_at).toLocaleString("de-DE", {
                                    day: "2-digit", month: "2-digit",
                                    hour: "2-digit", minute: "2-digit",
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          {isReplied && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3 mr-1 inline" /> Beantwortet
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/outreach/linkedin/${j.id}`}
                            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
                          >
                            {isPending ? "InMail vorbereiten" : "Details"}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
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
