import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Radar, Plus, CheckCircle2, Clock, XCircle, PauseCircle, Loader2,
  Activity, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DiscoveryCampaign } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: "Ausstehend",    className: "bg-slate-700 text-slate-300" },
    running:   { label: "Läuft…",        className: "bg-blue-700/40 text-blue-300 animate-pulse" },
    completed: { label: "Abgeschlossen", className: "bg-green-700/40 text-green-300" },
    failed:    { label: "Fehler",        className: "bg-red-700/40 text-red-300" },
    paused:    { label: "Pausiert",      className: "bg-yellow-700/40 text-yellow-300" },
  };
  const { label, className } = map[status] ?? { label: status, className: "bg-slate-700 text-slate-300" };
  return <Badge className={`${className} border-0 text-xs`}>{label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (status === "running")   return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
  if (status === "failed")    return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "paused")    return <PauseCircle className="h-4 w-4 text-yellow-400" />;
  return <Clock className="h-4 w-4 text-slate-400" />;
}

interface CellProgress {
  total: number;
  pending: number;
  searching: number;
  done: number;
  no_results: number;
  error: number;
  paused: number;
}

function CellProgressBar({ p }: { p: CellProgress }) {
  if (p.total === 0) return <span className="text-xs text-slate-400">—</span>;
  const completed = p.done + p.no_results;
  const pct = Math.round((completed / p.total) * 100);
  const errPct = (p.error / p.total) * 100;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${(p.done / p.total) * 100}%` }} />
        <div className="h-full bg-slate-300 transition-all" style={{ width: `${(p.no_results / p.total) * 100}%` }} />
        {p.error > 0 && (
          <div className="h-full bg-red-500 transition-all" style={{ width: `${errPct}%` }} />
        )}
        {p.searching > 0 && (
          <div className="h-full bg-blue-400 animate-pulse transition-all" style={{ width: `${(p.searching / p.total) * 100}%` }} />
        )}
      </div>
      <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
        {completed}/{p.total} {pct ? `· ${pct}%` : ""}
      </span>
    </div>
  );
}

export default async function DiscoveryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // DB-backed admin role check
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("user_settings").select("role").eq("user_id", user.id).maybeSingle();
  if (profile?.role !== "admin") redirect("/dashboard");

  const { data: campaigns } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  const list: DiscoveryCampaign[] = campaigns ?? [];

  // Cell progress per campaign — single query, group in JS
  const { data: cellRows } = await adminSupabase
    .from("search_cells")
    .select("campaign_id, status");
  const cellsByCampaign = new Map<string, CellProgress>();
  for (const c of list) {
    cellsByCampaign.set(c.id, { total: 0, pending: 0, searching: 0, done: 0, no_results: 0, error: 0, paused: 0 });
  }
  for (const r of cellRows ?? []) {
    const p = cellsByCampaign.get(r.campaign_id as string);
    if (!p) continue;
    p.total++;
    const s = r.status as keyof CellProgress;
    if (s in p) p[s]++;
  }

  // Pending enrichment indicator (legacy — leads waiting for solar/contacts)
  const { data: pendingRows } = await supabase
    .from("discovery_leads")
    .select("campaign_id")
    .in("status", ["pending_enrichment", "enriching"]);
  const pendingByCampaign = (pendingRows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.campaign_id] = (acc[r.campaign_id] ?? 0) + 1;
    return acc;
  }, {});

  // Heartbeat status from system_health_events
  const { data: lastHeartbeat } = await adminSupabase
    .from("system_health_events")
    .select("ts")
    .eq("source", "discovery_tick")
    .eq("kind", "heartbeat")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  const heartbeatTs = lastHeartbeat?.ts ? new Date(lastHeartbeat.ts as string) : null;
  const heartbeatAgeMin = heartbeatTs ? Math.floor((Date.now() - heartbeatTs.getTime()) / 60_000) : null;
  const heartbeatStale = !heartbeatTs || (heartbeatAgeMin ?? 999) > 15;

  // Recent errors (24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: errorsLast24h } = await adminSupabase
    .from("system_health_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "error")
    .gte("ts", oneDayAgo);

  const totalDiscovered = list.reduce((s, c) => s + c.total_discovered, 0);
  const totalReady      = list.reduce((s, c) => s + c.total_ready, 0);
  const totalApproved   = list.reduce((s, c) => s + c.total_approved, 0);
  const totalCellsActive = Array.from(cellsByCampaign.values()).reduce((s, p) => s + p.pending + p.searching, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Radar className="h-6 w-6 text-[#B2D082]" />
            Lead-Entdeckung
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Kampagnen werden automatisch alle 5 Min verarbeitet — kein manuelles Starten nötig.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/discovery/health"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
              heartbeatStale
                ? "bg-red-50 border-red-300 text-red-800 hover:bg-red-100"
                : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${heartbeatStale ? "bg-red-500" : "bg-green-500 animate-pulse"}`} />
            <Activity className="h-4 w-4" />
            System-Status
            {(errorsLast24h ?? 0) > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold w-5 h-5">
                {errorsLast24h}
              </span>
            )}
          </Link>
          <Link
            href="/admin/discovery/new"
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#1F3D2E]"
            style={{ backgroundColor: "#B2D082" }}
          >
            <Plus className="h-4 w-4" />
            Neue Kampagne
          </Link>
        </div>
      </div>

      {/* Heartbeat-Stale Banner — only when something is wrong */}
      {heartbeatStale && (
        <Card className="bg-red-50 border-red-300">
          <CardContent className="py-3 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">
                Cron läuft nicht — letzter Tick: {heartbeatTs ? `vor ${heartbeatAgeMin} Min` : "nie"}
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Neue Cells werden nicht abgearbeitet. Details + Logs unter{" "}
                <Link href="/admin/discovery/health" className="underline">System-Status</Link>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats — now incl. live cell counter */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Kampagnen", value: list.length },
          { label: "Cells offen", value: totalCellsActive, hint: "pending + searching" },
          { label: "Entdeckt", value: totalDiscovered },
          { label: "Bereit zur Prüfung", value: totalReady },
          { label: "Genehmigt", value: totalApproved, highlight: true },
        ].map((s) => (
          <Card key={s.label} className="bg-white border-slate-200">
            <CardContent className="pt-5">
              <div className={`text-2xl font-bold ${s.highlight ? "text-[#B2D082]" : "text-slate-900"}`}>
                {s.value}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {s.label}
                {s.hint && <span className="text-slate-400"> · {s.hint}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Campaign list */}
      {list.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <CardContent className="py-16 text-center">
            <Radar className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">Noch keine Kampagnen angelegt.</p>
            <p className="text-slate-400 text-sm mt-1">
              Erstelle eine Kampagne — sie wird automatisch im Hintergrund abgearbeitet.
            </p>
            <Link
              href="/admin/discovery/new"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#1F3D2E] mt-6"
              style={{ backgroundColor: "#B2D082" }}
            >
              <Plus className="h-4 w-4" />
              Erste Kampagne anlegen
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-slate-900 text-base">Alle Kampagnen</CardTitle>
              <p className="text-xs text-slate-500">
                Cron-Tick alle 5 Min · Letzter: {heartbeatTs ? `vor ${heartbeatAgeMin} Min` : "—"}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {["Status", "Name", "Cell-Fortschritt", "Gebiete", "Branchen", "Entdeckt", "Bereit", "Genehmigt", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const areas = (c.areas as { value: string }[]) ?? [];
                  const cats  = (c.categories as string[]) ?? [];
                  const cells = cellsByCampaign.get(c.id) ?? { total: 0, pending: 0, searching: 0, done: 0, no_results: 0, error: 0, paused: 0 };
                  return (
                    <tr key={c.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={c.status} />
                          <StatusBadge status={c.status} />
                          {(pendingByCampaign[c.id] ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {pendingByCampaign[c.id]} anreichern…
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                      <td className="px-4 py-3">
                        <CellProgressBar p={cells} />
                        {cells.error > 0 && (
                          <p className="text-[10px] text-red-600 mt-0.5">⚠ {cells.error} Fehler</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {areas.slice(0, 2).map((a) => a.value).join(", ")}
                        {areas.length > 2 && ` +${areas.length - 2}`}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {cats.length} Branche{cats.length !== 1 ? "n" : ""}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{c.total_discovered}</td>
                      <td className="px-4 py-3 text-slate-900">{c.total_ready}</td>
                      <td className="px-4 py-3">
                        <span className="text-[#B2D082] font-medium">{c.total_approved}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/discovery/${c.id}`}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Öffnen →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Help text */}
      <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
        <p>
          <strong className="text-slate-700">Wie es funktioniert:</strong>{" "}
          Jede Kampagne wird in <em>Such-Cells</em> zerlegt (eine Cell = ein Gebiet × eine Branche).
          Der Server arbeitet alle 5 Minuten 2-3 Cells ab — du musst nichts triggern.
          Pausen, Neustarts, Browser zu — alles unkritisch, der Fortschritt wird in der DB gespeichert.
        </p>
        <p className="mt-1.5">
          <strong className="text-slate-700">Wenn was schief läuft:</strong>{" "}
          Banner oben wird rot, oder du bekommst eine E-Mail. Manuelles Boost auf{" "}
          <Link href="/admin/discovery/health" className="text-blue-600 hover:underline">System-Status</Link> möglich.
        </p>
      </div>
    </div>
  );
}
