"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Euro,
  Loader2,
  Mail,
  Play,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

interface HealthData {
  heartbeat: {
    lastCronTick: string | null;
    lastBoost: string | null;
    stale: boolean;
    ageMinutes: number | null;
  };
  cells: {
    pending: number;
    searching: number;
    done: number;
    no_results: number;
    error: number;
    paused: number;
    total: number;
  };
  errors: {
    last24h: number;
    byKind: Record<string, number>;
    sample: Array<{
      id: string;
      area: string;
      category: string;
      message: string;
      kind: string | null;
      attempts: number;
      at: string;
    }>;
  };
  budget: {
    configuredEur: number;
    alertEmail: string | null;
    todayCalls: number;
    todayCostEur: number;
    manualCalls: number;
    manualCostEur: number;
  };
  alerts: { last24h: number };
  recentEvents: Array<{
    id: string;
    ts: string;
    source: string;
    kind: string;
    message: string;
    context: Record<string, unknown> | null;
  }>;
  activeCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    total_discovered: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

const ERROR_KIND_LABELS: Record<string, { label: string; color: string }> = {
  timeout: { label: "Timeout", color: "bg-amber-100 text-amber-800" },
  rate_limit: { label: "Rate-Limit", color: "bg-orange-100 text-orange-800" },
  auth: { label: "Auth/API-Key", color: "bg-red-100 text-red-800" },
  network: { label: "Netzwerk", color: "bg-slate-100 text-slate-800" },
  other: { label: "Sonstige", color: "bg-slate-100 text-slate-800" },
};

const KIND_BADGES: Record<string, string> = {
  heartbeat: "bg-slate-100 text-slate-600",
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
  alert_sent: "bg-purple-100 text-purple-800",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "nie";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h`;
  return `${Math.floor(ms / 86400_000)} Tage`;
}

export default function DiscoveryHealthPage() {
  const { toast } = useToast();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [boosting, setBoosting] = useState(false);

  const fetchHealth = async () => {
    try {
      const r = await fetch("/api/admin/discovery/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: HealthData = await r.json();
      setData(d);
    } catch (e) {
      console.error("[health] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const iv = setInterval(fetchHealth, 10_000);
    return () => clearInterval(iv);
  }, []);

  const handleBoost = async () => {
    setBoosting(true);
    let totalProcessed = 0;
    let totalNew = 0;
    let consecutiveIdle = 0;

    try {
      while (true) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90_000);
        try {
          const res = await fetch("/api/admin/tools/discovery-run", {
            method: "POST",
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            toast({ title: "Boost-Fehler", description: `HTTP ${res.status}`, variant: "destructive" });
            break;
          }
          const d = await res.json();
          totalProcessed += d.processed ?? 0;
          totalNew += d.placesNewTotal ?? 0;
          await fetchHealth();
          if (d.idle) {
            if (++consecutiveIdle >= 2) break;
          } else {
            consecutiveIdle = 0;
          }
          if (d.reason === "budget_exceeded") {
            toast({
              title: "Budget aufgebraucht",
              description: `€${d.budget?.spent?.toFixed(2)} von €${d.budget?.budget}`,
              variant: "destructive",
            });
            break;
          }
        } catch (e) {
          clearTimeout(timer);
          console.warn("[boost] error:", e);
          break;
        }
      }
      toast({
        title: "Boost beendet",
        description: `${totalProcessed} Cells verarbeitet, ${totalNew} neue Leads`,
      });
    } finally {
      setBoosting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const heartbeatColor = data.heartbeat.stale ? "bg-red-500" : "bg-green-500";
  const heartbeatLabel = data.heartbeat.stale
    ? "STALE — Cron läuft nicht"
    : `OK — letzter Tick vor ${data.heartbeat.ageMinutes ?? "?"} min`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Discovery Health</h1>
          <p className="text-muted-foreground">
            Status der automatisierten Lead-Suche · Refresh alle 10 Sek.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchHealth}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload
          </Button>
          <Button onClick={handleBoost} disabled={boosting} className="bg-blue-600 hover:bg-blue-700 text-white">
            {boosting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Boost läuft…
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" /> Jetzt beschleunigen
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Heartbeat Banner */}
      <Card className={data.heartbeat.stale ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"}>
        <CardContent className="py-4 flex items-center gap-4">
          <div className={`h-3 w-3 rounded-full ${heartbeatColor} ${data.heartbeat.stale ? "" : "animate-pulse"}`} />
          <div className="flex-1">
            <p className={`font-medium ${data.heartbeat.stale ? "text-red-900" : "text-green-900"}`}>
              {heartbeatLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              Cron-Tick: {timeAgo(data.heartbeat.lastCronTick)} · Boost: {timeAgo(data.heartbeat.lastBoost)}
            </p>
          </div>
          {data.heartbeat.stale && (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              Cron nicht aktiv
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Insgesamt", value: data.cells.total, color: "bg-slate-50" },
          { label: "Ausstehend", value: data.cells.pending, color: "bg-amber-50 text-amber-900" },
          { label: "Läuft", value: data.cells.searching, color: "bg-blue-50 text-blue-900" },
          { label: "Fertig", value: data.cells.done, color: "bg-green-50 text-green-900" },
          { label: "Leer", value: data.cells.no_results, color: "bg-slate-50" },
          { label: "Fehler", value: data.cells.error, color: "bg-red-50 text-red-900" },
          { label: "Pausiert", value: data.cells.paused, color: "bg-purple-50 text-purple-900" },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg border p-3 ${s.color}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-60">{s.label}</div>
            <div className="text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Budget */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Euro className="h-5 w-5 text-amber-600" /> Tagesbudget Google Places
          </CardTitle>
          <CardDescription>
            Heutige Nutzung · Automatisierung wird gekappt, manuelle Suchen laufen frei
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Automation budget — capped */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">Automatisierung</span>
                <span className="text-lg font-bold">€{data.budget.todayCostEur.toFixed(2)}</span>
                {data.budget.configuredEur > 0 && (
                  <span className="text-sm text-muted-foreground">von €{data.budget.configuredEur.toFixed(2)}</span>
                )}
              </div>
              <span className="text-xs text-slate-400">{data.budget.todayCalls} Calls</span>
            </div>
            {data.budget.configuredEur > 0 ? (
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    data.budget.todayCostEur >= data.budget.configuredEur
                      ? "bg-red-500"
                      : data.budget.todayCostEur >= data.budget.configuredEur * 0.8
                      ? "bg-amber-500"
                      : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (data.budget.todayCostEur / data.budget.configuredEur) * 100
                    )}%`,
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500">Kein Budget gesetzt — Cron läuft unbegrenzt.</p>
            )}
          </div>

          {/* Manual usage — never capped, just visibility */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">Manuelle Suchen</span>
                <span className="text-lg font-bold text-blue-700">€{data.budget.manualCostEur.toFixed(2)}</span>
              </div>
              <span className="text-xs text-slate-400">{data.budget.manualCalls} Calls</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Über <code>/dashboard/search</code> ausgelöst. Wird <strong>nicht</strong> vom Tagesbudget gekappt — Nutzer können jederzeit ad-hoc suchen.
            </p>
          </div>

          {/* Total */}
          <div className="pt-3 border-t border-slate-100 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-500">Gesamt heute</span>
            <span className="text-base font-semibold text-slate-700">
              €{(data.budget.todayCostEur + data.budget.manualCostEur).toFixed(2)}
              <span className="text-xs text-slate-400 ml-2">({data.budget.todayCalls + data.budget.manualCalls} Calls)</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Errors Card */}
      {data.errors.last24h > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-900">
              <AlertCircle className="h-5 w-5" /> Fehler in den letzten 24h: {data.errors.last24h}
            </CardTitle>
            <CardDescription>
              {Object.entries(data.errors.byKind)
                .map(([k, n]) => `${ERROR_KIND_LABELS[k]?.label ?? k}: ${n}`)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.errors.sample.map((e) => (
                <li key={e.id} className="border-l-2 border-red-300 pl-3 py-1">
                  <div className="flex items-center gap-2">
                    <Badge className={ERROR_KIND_LABELS[e.kind ?? "other"]?.color ?? ""}>
                      {ERROR_KIND_LABELS[e.kind ?? "other"]?.label ?? "?"}
                    </Badge>
                    <span className="font-medium">{e.area} / {e.category}</span>
                    <span className="text-xs text-muted-foreground">
                      Versuch {e.attempts} · {timeAgo(e.at)} her
                    </span>
                  </div>
                  <div className="text-xs text-red-700 mt-0.5 truncate" title={e.message}>
                    {e.message}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Alerts Sent */}
      {data.alerts.last24h > 0 && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="py-4 flex items-center gap-3">
            <Mail className="h-5 w-5 text-purple-700" />
            <div className="flex-1">
              <p className="font-medium text-purple-900">
                {data.alerts.last24h} Alert-E-Mail{data.alerts.last24h === 1 ? "" : "s"} in den letzten 24h verschickt
              </p>
              <p className="text-xs text-purple-700">
                Empfänger: {data.budget.alertEmail ?? "(nicht konfiguriert)"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!data.budget.alertEmail && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">Keine Alert-E-Mail konfiguriert</p>
              <p className="text-xs text-amber-700">
                Bei kritischen Fehlern (API-Key kaputt, Budget aufgebraucht) bekommst du keine Benachrichtigung.
                Konfiguriere <code>alert_email</code> in den Settings.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Campaigns */}
      {data.activeCampaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-blue-600" /> Aktive Kampagnen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.activeCampaigns.map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b last:border-b-0 pb-2 last:pb-0">
                  <Badge variant="outline">{c.status}</Badge>
                  <span className="font-medium flex-1">{c.name}</span>
                  <span className="text-muted-foreground">{c.total_discovered} Leads</span>
                  <span className="text-xs text-muted-foreground">
                    seit {c.started_at ? timeAgo(c.started_at) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Event Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> System-Events
          </CardTitle>
          <CardDescription>
            Heartbeats, Warnungen, Fehler · letzte 50 Einträge
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 max-h-96 overflow-auto pr-2">
            {data.recentEvents.map((e) => (
              <li key={e.id} className="text-xs flex items-start gap-2 py-1 border-b last:border-b-0">
                <Badge variant="outline" className={`shrink-0 ${KIND_BADGES[e.kind] ?? ""}`}>
                  {e.kind}
                </Badge>
                <span className="text-muted-foreground shrink-0 w-12 tabular-nums">
                  {timeAgo(e.ts)}
                </span>
                <span className="text-muted-foreground shrink-0 w-24 truncate" title={e.source}>
                  {e.source}
                </span>
                <span className="flex-1 truncate" title={e.message}>{e.message}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Setup Hint */}
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Cron-Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>Auf dem Server (<code>solarlead@host</code>) per <code>crontab -e</code>:</p>
          <pre className="bg-white border rounded p-2 mt-2 overflow-auto">
{`*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/discovery-tick > /dev/null`}
          </pre>
          <p>Damit läuft alle 5 Minuten ein Tick (3 Cells × ~60s = ~3 Min Arbeit).</p>
          <p>
            Alle Aktivitäten werden hier sichtbar. Wenn der Tick stoppt, wird der Heartbeat oben rot.
            Bei kritischen Fehlern bekommst du eine E-Mail (sofern <code>alert_email</code> in den Settings gesetzt).
          </p>
        </CardContent>
      </Card>

      {!boosting && data.cells.searching === 0 && data.cells.pending > 0 && data.heartbeat.stale && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-amber-700" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">
                {data.cells.pending} Cells warten — Cron läuft aber nicht
              </p>
              <p className="text-xs text-amber-700">
                Klick „Jetzt beschleunigen" um die Queue zu starten, oder richte den Cron-Job auf dem Server ein.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
