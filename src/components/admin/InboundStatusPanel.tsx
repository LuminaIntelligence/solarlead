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
}

interface InboundStatus {
  signing_key_set: boolean;
  inbound_domain: string | null;
  mx_records: MxRecord[];
  mx_points_at_mailgun: boolean;
  mx_error: string | null;
  sent_job_count: number;
  events_table_missing: boolean;
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RESULT_LABEL: Record<string, { label: string; color: string }> = {
  matched: { label: "Match", color: "bg-green-100 text-green-800" },
  no_match: { label: "Kein Job-Match", color: "bg-amber-100 text-amber-800" },
  invalid_signature: { label: "Signatur ungültig", color: "bg-red-100 text-red-800" },
  no_from_address: { label: "Kein Absender", color: "bg-slate-100 text-slate-700" },
  error: { label: "Fehler", color: "bg-red-100 text-red-800" },
};

export function InboundStatusPanel() {
  const [data, setData] = useState<InboundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  // Compute overall health for the collapsed badge
  const allGood =
    data.signing_key_set &&
    data.mx_points_at_mailgun &&
    !data.events_table_missing;
  const hasWarning = !data.signing_key_set || !data.mx_points_at_mailgun;

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
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500" />
            )}
            <span className="text-sm font-semibold text-slate-800">
              Inbound-Setup-Status
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
            <span className="text-xs text-slate-500 ml-2">
              {data.counts_7d.total > 0
                ? `${data.counts_7d.total} Webhook-Calls in 7d (${data.counts_7d.matched} Matches, ${data.counts_7d.no_match} ohne Match)`
                : "Keine Webhook-Calls in 7d"}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              load();
            }}
            className="text-slate-500 hover:text-slate-900"
            title="Status aktualisieren"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
            {/* Checks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
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
                ok={!data.events_table_missing}
                label="Event-Log-Tabelle vorhanden"
                detail={
                  data.events_table_missing
                    ? "Migration 20260507_mailgun_inbound_events.sql noch nicht ausgeführt"
                    : "mailgun_inbound_events ist da"
                }
              />
            </div>

            {/* Webhook URL reminder */}
            <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2">
              <div className="font-semibold text-slate-800 mb-1">Mailgun-Route Forward-URL:</div>
              <code className="bg-slate-100 px-1 rounded text-slate-700">
                {data.webhook_url}
              </code>
            </div>

            {/* Recent events */}
            <div>
              <div className="text-xs font-semibold text-slate-800 mb-1.5">
                Letzte 20 Webhook-Calls
              </div>
              {data.events_table_missing ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Migration fehlt — ohne die kann nicht protokolliert werden.
                </div>
              ) : data.recent_events.length === 0 ? (
                <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded p-2">
                  Noch keine Webhook-Calls protokolliert. Wenn Mailgun feuern sollte
                  und hier nichts auftaucht, prüfe die Mailgun-Logs (Receiving →
                  Logs) — wahrscheinlich kommt die Mail gar nicht erst bei Mailgun
                  an (MX-Records?) oder die Route trifft nicht.
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        <th className="px-2 py-1.5 font-medium text-slate-600">Zeit</th>
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
                            <td className="px-2 py-1.5 text-slate-700 truncate max-w-[180px]">
                              {e.from_email ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 truncate max-w-[180px]">
                              {e.recipient ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600 truncate max-w-[200px]">
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
