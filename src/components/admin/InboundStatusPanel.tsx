"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface MxRecord {
  exchange: string;
  priority: number;
}

interface InboundEvent {
  id: string;
  received_at: string;
  from_email: string | null;
  recipient: string | null;
  subject: string | null;
  result: string;
  job_id: string | null;
  is_opt_out: boolean;
  error_message: string | null;
  source?: string;
}

interface InboundStatus {
  active_channel: "mailgun" | "imap";

  // Mailgun
  signing_key_set: boolean;
  inbound_domain: string | null;
  mx_records: MxRecord[];
  mx_points_at_mailgun: boolean;
  mx_error: string | null;

  // IMAP
  imap_configured: boolean;
  imap_host: string | null;
  imap_user: string | null;
  imap_state: {
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    messages_checked: number;
    replies_found: number;
    opt_outs_found: number;
  } | null;
  imap_state_missing: boolean;

  // Common
  sent_job_count: number;
  events_table_missing: boolean;
  source_column_missing: boolean;
  recent_events: InboundEvent[];
  counts_7d: {
    matched: number;
    no_match: number;
    invalid_signature: number;
    total: number;
  };
  webhook_url: string;
}

function StatusRow({
  ok,
  warn,
  label,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  detail: React.ReactNode;
}) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const color = ok
    ? "text-green-600"
    : warn
    ? "text-amber-600"
    : "text-red-600";
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className={`h-4 w-4 ${color} shrink-0 mt-0.5`} />
      <div className="text-xs flex-1 min-w-0">
        <div className="text-slate-800 font-medium">{label}</div>
        <div className="text-slate-500 mt-0.5 break-all">{detail}</div>
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nie";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} Tagen`;
}

const RESULT_LABEL: Record<string, { label: string; color: string }> = {
  matched: { label: "Match", color: "bg-green-100 text-green-800" },
  no_match: { label: "Kein Job-Match", color: "bg-amber-100 text-amber-800" },
  invalid_signature: { label: "Signatur ungültig", color: "bg-red-100 text-red-800" },
  no_from_address: { label: "Kein Absender", color: "bg-slate-100 text-slate-700" },
  error: { label: "Fehler", color: "bg-red-100 text-red-800" },
};

export function InboundStatusPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<InboundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/outreach/inbound-status");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/outreach/sync-replies", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast({
          title: "Sync fehlgeschlagen",
          description: json.error ?? "Unbekannter Fehler",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Postfach synchronisiert",
        description: `${json.messagesChecked ?? 0} Mails geprüft · ${json.repliesFound ?? 0} neue Antworten · ${json.optedOutFound ?? 0} Opt-Outs`,
      });
      await load();
    } catch (err) {
      toast({
        title: "Sync fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="py-3 px-5 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Inbound-Status wird geprüft…
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="py-3 px-5 text-xs text-red-700">
          Inbound-Status konnte nicht geladen werden.
        </CardContent>
      </Card>
    );
  }

  // Compute health based on active channel
  const isImap = data.active_channel === "imap";
  const channelLabel = isImap ? "IMAP-Pull" : "Mailgun-Webhook";

  const allGood = isImap
    ? data.imap_configured &&
      !!data.imap_state?.last_success_at &&
      !data.events_table_missing
    : data.signing_key_set &&
      data.mx_points_at_mailgun &&
      !data.events_table_missing;

  const hasWarning = isImap
    ? !data.imap_state?.last_success_at || !!data.imap_state?.last_error
    : !data.signing_key_set || !data.mx_points_at_mailgun;

  return (
    <Card
      className={
        allGood
          ? "bg-green-50 border-green-200"
          : hasWarning
          ? "bg-amber-50 border-amber-200"
          : "bg-slate-50 border-slate-200"
      }
    >
      <CardContent className="py-3 px-5">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-left flex-1 min-w-0"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
            )}
            <span className="text-sm font-semibold text-slate-800">
              Inbound-Setup-Status
            </span>
            <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
              {channelLabel}
            </span>
            {allGood ? (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                Alles grün
              </span>
            ) : hasWarning ? (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                Setup unvollständig
              </span>
            ) : null}
            <span className="text-xs text-slate-500 ml-2 truncate">
              {isImap && data.imap_state?.last_success_at
                ? `Letzter Sync: ${timeAgo(data.imap_state.last_success_at)} · ${data.counts_7d.total} Calls / 7d`
                : data.counts_7d.total > 0
                ? `${data.counts_7d.total} Calls / 7d (${data.counts_7d.matched} Matches, ${data.counts_7d.no_match} ohne Match)`
                : "Noch keine Inbound-Calls"}
            </span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {isImap && data.imap_configured && (
              <Button
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="h-7 text-xs"
              >
                {syncing ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Jetzt syncen
              </Button>
            )}
            <button
              onClick={load}
              className="text-slate-500 hover:text-slate-900"
              title="Status aktualisieren"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
            {/* Channel-specific checks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
              {isImap ? (
                <>
                  <StatusRow
                    ok={data.imap_configured}
                    label="IMAP konfiguriert"
                    detail={
                      data.imap_configured ? (
                        <span>
                          {data.imap_user} @ {data.imap_host}
                        </span>
                      ) : (
                        <span className="text-red-600">
                          IMAP_HOST / IMAP_USER / IMAP_PASS in .env.local fehlen
                        </span>
                      )
                    }
                  />
                  <StatusRow
                    ok={!!data.imap_state?.last_success_at}
                    warn={!!data.imap_state?.last_error}
                    label="Letzter erfolgreicher Sync"
                    detail={
                      data.imap_state?.last_error ? (
                        <span className="text-red-600">
                          Fehler: {data.imap_state.last_error}
                        </span>
                      ) : data.imap_state?.last_success_at ? (
                        <span>
                          {formatTime(data.imap_state.last_success_at)} ·{" "}
                          {data.imap_state.messages_checked} geprüft,{" "}
                          {data.imap_state.replies_found} Replies,{" "}
                          {data.imap_state.opt_outs_found} Opt-Outs
                        </span>
                      ) : (
                        <span>Noch nicht gelaufen — Cron oder „Jetzt syncen" klicken</span>
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <StatusRow
                    ok={data.mx_points_at_mailgun}
                    label="MX-Records zeigen auf Mailgun"
                    detail={
                      data.mx_error ? (
                        <span className="text-red-600">
                          DNS-Fehler: {data.mx_error}
                        </span>
                      ) : data.mx_records.length === 0 ? (
                        <span className="text-red-600">
                          Keine MX-Records für{" "}
                          <code className="bg-slate-200 px-1 rounded">
                            {data.inbound_domain ?? "(keine Domain konfiguriert)"}
                          </code>
                        </span>
                      ) : (
                        <span>
                          {data.inbound_domain}:{" "}
                          {data.mx_records
                            .map((r) => `${r.exchange} (prio ${r.priority})`)
                            .join(", ")}
                        </span>
                      )
                    }
                  />
                  <StatusRow
                    ok={data.signing_key_set}
                    warn={!data.signing_key_set}
                    label="MAILGUN_WEBHOOK_SIGNING_KEY gesetzt"
                    detail={
                      data.signing_key_set
                        ? "Server kann Webhook-Signaturen verifizieren"
                        : "Ohne Key wird Signatur-Check übersprungen — unsicher in Production"
                    }
                  />
                </>
              )}
              <StatusRow
                ok={data.sent_job_count > 0}
                warn={data.sent_job_count === 0}
                label="Outreach läuft (versendete Jobs)"
                detail={
                  data.sent_job_count === 0
                    ? "Noch kein einziger Outreach-Job mit status='sent' — selbst wenn Mails reinkommen, gibt's keine Jobs zum Matchen"
                    : `${data.sent_job_count} Jobs in Status sent/opened (Match-Pool)`
                }
              />
              <StatusRow
                ok={!data.events_table_missing && !data.source_column_missing}
                warn={data.source_column_missing}
                label="Event-Log-Tabelle vorhanden"
                detail={
                  data.events_table_missing
                    ? "Migration 20260507_mailgun_inbound_events.sql fehlt"
                    : data.source_column_missing
                    ? "Migration 20260508_inbound_events_source.sql fehlt (source-Spalte)"
                    : "mailgun_inbound_events ist da"
                }
              />
            </div>

            {/* IMAP-Cron hint */}
            {isImap && (
              <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2">
                <div className="font-semibold text-slate-800 mb-1">Auto-Sync alle 10 Minuten</div>
                GitHub Actions Cron <code className="bg-slate-100 px-1 rounded">imap-sync.yml</code>{" "}
                ruft <code className="bg-slate-100 px-1 rounded">/api/cron/imap-sync</code> auf.
                Sicherheits-Header: <code className="bg-slate-100 px-1 rounded">x-cron-secret</code>.
              </div>
            )}

            {/* Mailgun webhook URL (when in mailgun mode) */}
            {!isImap && (
              <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2">
                <div className="font-semibold text-slate-800 mb-1">Mailgun-Route Forward-URL:</div>
                <code className="bg-slate-100 px-1 rounded text-slate-700">
                  {data.webhook_url}
                </code>
              </div>
            )}

            {/* Recent events */}
            <div>
              <div className="text-xs font-semibold text-slate-800 mb-1.5">
                Letzte 20 Inbound-Events
              </div>
              {data.events_table_missing ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Migration fehlt — ohne die kann nicht protokolliert werden.
                </div>
              ) : data.recent_events.length === 0 ? (
                <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded p-2">
                  Noch keine Events protokolliert. {isImap
                    ? "Sobald der Cron läuft (oder du den Sync-Button klickst), tauchen hier die Resultate auf."
                    : "Wenn Mailgun feuern sollte und hier nichts auftaucht, prüfe Mailgun → Receiving → Logs."}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        <th className="px-2 py-1.5 font-medium text-slate-600">Zeit</th>
                        <th className="px-2 py-1.5 font-medium text-slate-600">Quelle</th>
                        <th className="px-2 py-1.5 font-medium text-slate-600">Von</th>
                        <th className="px-2 py-1.5 font-medium text-slate-600">An</th>
                        <th className="px-2 py-1.5 font-medium text-slate-600">Betreff</th>
                        <th className="px-2 py-1.5 font-medium text-slate-600">Resultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_events.map((e) => {
                        const meta = RESULT_LABEL[e.result] ?? {
                          label: e.result,
                          color: "bg-slate-100 text-slate-700",
                        };
                        return (
                          <tr key={e.id} className="border-b last:border-0 border-slate-100">
                            <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">
                              {formatTime(e.received_at)}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                                {e.source ?? "mailgun"}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-700 truncate max-w-[160px]">
                              {e.from_email ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 truncate max-w-[160px]">
                              {e.recipient ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600 truncate max-w-[180px]">
                              {e.subject ?? "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.color}`}
                              >
                                {meta.label}
                                {e.is_opt_out ? " (Opt-Out)" : ""}
                              </span>
                              {e.error_message && (
                                <div className="text-[10px] text-red-600 mt-0.5">
                                  {e.error_message}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
