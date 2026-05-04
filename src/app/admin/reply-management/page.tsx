"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, BarChart3, Crown, Inbox, Loader2,
  RefreshCw, TrendingDown, TrendingUp, Trophy, Users, Mail,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReassignDropdown } from "@/components/team/reassign-dropdown";
import { ACTIVITY_KIND_LABELS } from "@/lib/constants/reply-outcomes";

interface OverviewData {
  kpis: {
    replies_today: number; replies_yesterday: number; replies_week: number;
    wins_month: number; wins_last_month: number; won_value_month_eur: number;
    open_total: number; pool_total: number;
  };
  funnel: { replies: number; appointments: number; offers: number; wins: number; lost: number };
  team: Array<{
    user_id: string; email: string | null; role: string;
    open: number; overdue: number;
    won_month: number; lost_month: number; not_int_month: number;
    won_value_month_eur: number; win_rate: number; last_activity_at: string | null;
  }>;
  activity_feed: Array<{
    id: string; job_id: string; job_name: string; user_email: string;
    kind: string; kind_label: string; content: string | null; created_at: string;
  }>;
  sla_violations: {
    pool: Array<{ id: string; company_name: string | null; replied_at: string | null; contact_name: string | null }>;
    response: Array<{ id: string; company_name: string | null; last_activity_at: string | null; assigned_to: string | null; assignee_email: string | null; outcome: string }>;
  };
  daily_trend: Array<{ date: string; replies: number; wins: number }>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h`;
  return `${Math.floor(ms / 86400_000)} Tage`;
}

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

export default function AdminReplyManagementPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/reply-management/overview");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
    const iv = setInterval(() => fetchData(false), 30_000);
    return () => clearInterval(iv);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const { kpis, funnel, team, activity_feed, sla_violations, daily_trend } = data;
  const todayDelta = kpis.replies_today - kpis.replies_yesterday;
  const winsMonthDelta = kpis.wins_month - kpis.wins_last_month;
  const trendMaxReplies = Math.max(1, ...daily_trend.map((d) => d.replies));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reply-Management</h1>
          <p className="text-muted-foreground">
            Big-Picture Dashboard · refresh alle 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/team/inbox">
            <Button variant="outline" size="sm">
              <Inbox className="h-4 w-4 mr-1.5" /> Inbox-Ansicht
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Replies heute"
          value={kpis.replies_today}
          delta={todayDelta}
          deltaLabel={`vs gestern (${kpis.replies_yesterday})`}
          color="bg-blue-50 text-blue-900"
        />
        <KpiCard
          label="Replies / 7 Tage"
          value={kpis.replies_week}
          color="bg-indigo-50 text-indigo-900"
        />
        <KpiCard
          label="Wins / Monat"
          value={kpis.wins_month}
          delta={winsMonthDelta}
          deltaLabel={`vs Vormonat (${kpis.wins_last_month})`}
          color="bg-green-50 text-green-900"
        />
        <KpiCard
          label="Volumen / Monat"
          value={`€${kpis.won_value_month_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}`}
          color="bg-amber-50 text-amber-900"
        />
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Funnel — diesen Monat
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-2">
            <FunnelStep label="Replies" value={funnel.replies} of={null} color="bg-blue-100 text-blue-900" />
            <FunnelStep label="Termine" value={funnel.appointments} of={funnel.replies} color="bg-purple-100 text-purple-900" />
            <FunnelStep label="Angebote" value={funnel.offers} of={funnel.appointments} color="bg-amber-100 text-amber-900" />
            <FunnelStep label="Wins" value={funnel.wins} of={funnel.offers || funnel.appointments} color="bg-green-100 text-green-900" />
            <FunnelStep label="Verloren" value={funnel.lost} of={funnel.replies} color="bg-red-100 text-red-900" />
          </div>
        </CardContent>
      </Card>

      {/* SLA-Violations + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* SLA */}
        <Card className={(sla_violations.pool.length || sla_violations.response.length) ? "border-red-300" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${(sla_violations.pool.length || sla_violations.response.length) ? "text-red-600" : "text-slate-400"}`} />
              SLA-Verletzungen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-700">Pool {">"}3h ohne Zuweisung</span>
                <span className={`font-bold ${sla_violations.pool.length > 0 ? "text-red-600" : "text-slate-400"}`}>
                  {sla_violations.pool.length}
                </span>
              </div>
              {sla_violations.pool.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {sla_violations.pool.slice(0, 3).map((j) => (
                    <li key={j.id} className="text-xs flex items-center justify-between gap-2">
                      <Link href={`/team/${j.id}`} className="text-blue-600 hover:underline truncate">
                        {j.company_name ?? "?"}
                      </Link>
                      <span className="text-slate-400">{timeAgo(j.replied_at)}</span>
                    </li>
                  ))}
                  {sla_violations.pool.length > 3 && (
                    <li className="text-xs text-slate-400">+ {sla_violations.pool.length - 3} weitere</li>
                  )}
                </ul>
              )}
            </div>
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-700">Reaktion {">"}24h</span>
                <span className={`font-bold ${sla_violations.response.length > 0 ? "text-red-600" : "text-slate-400"}`}>
                  {sla_violations.response.length}
                </span>
              </div>
              {sla_violations.response.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {sla_violations.response.slice(0, 5).map((j) => (
                    <li key={j.id} className="text-xs flex items-center justify-between gap-2">
                      <Link href={`/team/${j.id}`} className="text-blue-600 hover:underline truncate flex-1">
                        {j.company_name ?? "?"}
                      </Link>
                      <span className="text-slate-400 shrink-0">{timeAgo(j.last_activity_at)}</span>
                      <ReassignDropdown
                        jobId={j.id}
                        currentAssigneeId={j.assigned_to}
                        currentAssigneeEmail={j.assignee_email}
                        onChange={() => fetchData()}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Daily trend (sparkline-style bars) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-600" /> Letzte 14 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {daily_trend.map((d) => {
                const h = (d.replies / trendMaxReplies) * 100;
                const winsH = d.wins > 0 ? Math.max(8, (d.wins / Math.max(1, d.replies)) * 100) : 0;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-stretch gap-0.5" title={`${d.date}: ${d.replies} Replies, ${d.wins} Wins`}>
                    <div className="flex-1 flex items-end">
                      <div className="w-full bg-blue-200 rounded-sm relative" style={{ height: `${h}%` }}>
                        {d.wins > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-sm" style={{ height: `${winsH}%` }} />
                        )}
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-400 text-center">
                      {new Date(d.date).getDate()}.
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-3 text-[10px] text-slate-500 mt-2">
              <span className="flex items-center gap-1"><span className="h-2 w-2 bg-blue-200 rounded-sm" />Replies</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 bg-green-500 rounded-sm" />Wins</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Team-Performance ({team.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 font-medium text-right">Offen</th>
                <th className="px-4 py-2 font-medium text-right">Überfällig</th>
                <th className="px-4 py-2 font-medium text-right">Wins / Monat</th>
                <th className="px-4 py-2 font-medium text-right">Win-Rate</th>
                <th className="px-4 py-2 font-medium text-right">Volumen</th>
                <th className="px-4 py-2 font-medium text-right">Letzte Aktivität</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => {
                const winRatePct = Math.round(m.win_rate * 100);
                const isWarn = m.overdue > 3 || (m.open > 25);
                return (
                  <tr key={m.user_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {m.role === "admin" && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                        {m.role === "team_lead" && <Crown className="h-3.5 w-3.5 text-purple-500" />}
                        <span className="font-medium">{m.email ?? m.user_id.slice(0, 8)}</span>
                        {m.role !== "reply_specialist" && (
                          <Badge variant="outline" className="text-[10px]">
                            {m.role === "admin" ? "Admin" : "Lead"}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${isWarn ? "text-orange-600 font-medium" : ""}`}>
                      {m.open}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${m.overdue > 0 ? "text-red-600 font-medium" : "text-slate-400"}`}>
                      {m.overdue}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-medium">
                      {m.won_month}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={winRatePct >= 30 ? "text-green-600 font-medium" : winRatePct >= 15 ? "text-amber-600" : "text-slate-500"}>
                        {m.won_month + m.lost_month + m.not_int_month > 0 ? `${winRatePct}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      €{m.won_value_month_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                      {m.last_activity_at ? `vor ${timeAgo(m.last_activity_at)}` : "nie"}
                    </td>
                  </tr>
                );
              })}
              {team.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    Noch keine Team-Mitglieder. Setze einen User auf <code>role=&apos;reply_specialist&apos;</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Activity Feed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> Live Activity Feed
            <span className="text-xs text-slate-400 ml-auto">letzte {activity_feed.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity_feed.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-6">Noch keine Aktivitäten.</p>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-auto pr-2">
              {activity_feed.map((a) => {
                const k = ACTIVITY_KIND_LABELS[a.kind as keyof typeof ACTIVITY_KIND_LABELS];
                return (
                  <li key={a.id} className="text-xs flex items-start gap-2 py-1 border-b border-slate-100 last:border-0">
                    <span className={`shrink-0 ${k?.color ?? "text-slate-500"}`}>{k?.emoji ?? "•"}</span>
                    <span className="text-slate-500 shrink-0 w-12 tabular-nums">{timeAgo(a.created_at)}</span>
                    <span className="text-slate-700 shrink-0 w-32 truncate" title={a.user_email}>{a.user_email}</span>
                    <Link href={`/team/${a.job_id}`} className="text-blue-600 hover:underline shrink-0 w-40 truncate" title={a.job_name}>
                      {a.job_name}
                    </Link>
                    <span className="text-slate-400 shrink-0">{k?.label ?? a.kind}</span>
                    {a.content && <span className="text-slate-600 truncate flex-1">— {a.content}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-slate-400 text-center">
        Auto-Refresh alle 30s · <Link href="/admin/outreach/replies" className="text-blue-600 hover:underline">klassische Replies-Inbox</Link>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, color, delta, deltaLabel,
}: {
  label: string;
  value: number | string;
  color: string;
  delta?: number;
  deltaLabel?: string;
}) {
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  return (
    <div className={`rounded-lg border px-4 py-3 ${color}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-3xl font-bold mt-0.5 tabular-nums">{value}</div>
      {delta !== undefined && (
        <div className="text-[11px] mt-1 flex items-center gap-1">
          {isUp && <TrendingUp className="h-3 w-3 text-green-600" />}
          {isDown && <TrendingDown className="h-3 w-3 text-red-600" />}
          <span className={isUp ? "text-green-700" : isDown ? "text-red-700" : "text-slate-500"}>
            {delta > 0 ? "+" : ""}{delta}
          </span>
          <span className="text-slate-500">{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}

function FunnelStep({ label, value, of, color }: { label: string; value: number; of: number | null; color: string }) {
  const ratio = of != null && of > 0 ? Math.round((value / of) * 100) : null;
  return (
    <div className={`rounded-md px-3 py-2 ${color}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-bold mt-0.5 tabular-nums">{value}</div>
      {ratio !== null && <div className="text-[10px] opacity-70 mt-0.5">{ratio}% Conv.</div>}
    </div>
  );
}
