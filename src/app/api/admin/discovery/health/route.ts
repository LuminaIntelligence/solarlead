/**
 * Discovery Health API — read-only data for the /admin/discovery/health dashboard.
 *
 * Returns:
 *   - lastHeartbeat (cron + boost)
 *   - heartbeatStale (boolean — true if no cron heartbeat in 15min)
 *   - cellCounts (pending / searching / done / no_results / error / paused)
 *   - recentErrors (last 20 'error' kind events, grouped by error_kind)
 *   - todayUsage (calls + estimated_cost_eur)
 *   - budget (configured cap)
 *   - alertsLast24h (count of 'alert_sent' events)
 *   - recentEvents (last 50 events of any kind)
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";
import { getLastHeartbeat, isHeartbeatStale } from "@/lib/discovery/health-tracker";
import { getTodayUsage } from "@/lib/discovery/cost-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { adminSupabase } = gate;

  const tickHeartbeat = await getLastHeartbeat(adminSupabase, "discovery_tick");
  const boostHeartbeat = await getLastHeartbeat(adminSupabase, "discovery_boost");
  const heartbeatStale = isHeartbeatStale(tickHeartbeat, 15);

  // Cell counts by status
  const baseCellsQuery = () =>
    adminSupabase.from("search_cells").select("id", { count: "exact", head: true });
  const [pendingC, searchingC, doneC, noResultsC, errorC, pausedC, totalC] = await Promise.all([
    baseCellsQuery().eq("status", "pending"),
    baseCellsQuery().eq("status", "searching"),
    baseCellsQuery().eq("status", "done"),
    baseCellsQuery().eq("status", "no_results"),
    baseCellsQuery().eq("status", "error"),
    baseCellsQuery().eq("status", "paused"),
    baseCellsQuery(),
  ]);

  // Recent errors grouped by error_kind
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: errorRows } = await adminSupabase
    .from("search_cells")
    .select("id, area_label, category, error_message, last_error_kind, attempts, last_attempt_at")
    .eq("status", "error")
    .gte("last_attempt_at", oneDayAgo)
    .order("last_attempt_at", { ascending: false })
    .limit(20);

  const errorsByKind: Record<string, number> = {};
  for (const e of errorRows ?? []) {
    const k = (e.last_error_kind as string) || "other";
    errorsByKind[k] = (errorsByKind[k] || 0) + 1;
  }

  // Auto = budgeted + capped. Manual = ad-hoc, never capped, just visibility.
  const [todayUsageAuto, todayUsageManual] = await Promise.all([
    getTodayUsage(adminSupabase, "google_places"),
    getTodayUsage(adminSupabase, "google_places_manual"),
  ]);

  // Configured budget
  const { data: settings } = await adminSupabase
    .from("user_settings")
    .select("places_daily_budget_eur, alert_email")
    .eq("role", "admin")
    .order("places_daily_budget_eur", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Alerts in last 24h
  const { count: alertsLast24h } = await adminSupabase
    .from("system_health_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "alert_sent")
    .gte("ts", oneDayAgo);

  // Recent events feed (last 50)
  const { data: recentEvents } = await adminSupabase
    .from("system_health_events")
    .select("id, ts, source, kind, message, context")
    .order("ts", { ascending: false })
    .limit(50);

  // Active campaigns
  const { data: activeCampaigns } = await adminSupabase
    .from("discovery_campaigns")
    .select("id, name, status, total_discovered, started_at, completed_at")
    .in("status", ["pending", "running", "paused"])
    .order("created_at", { ascending: false });

  return NextResponse.json({
    heartbeat: {
      lastCronTick: tickHeartbeat?.toISOString() ?? null,
      lastBoost: boostHeartbeat?.toISOString() ?? null,
      stale: heartbeatStale,
      ageMinutes: tickHeartbeat
        ? Math.floor((Date.now() - tickHeartbeat.getTime()) / 60_000)
        : null,
    },
    cells: {
      pending: pendingC.count ?? 0,
      searching: searchingC.count ?? 0,
      done: doneC.count ?? 0,
      no_results: noResultsC.count ?? 0,
      error: errorC.count ?? 0,
      paused: pausedC.count ?? 0,
      total: totalC.count ?? 0,
    },
    errors: {
      last24h: errorRows?.length ?? 0,
      byKind: errorsByKind,
      sample: (errorRows ?? []).slice(0, 5).map((e) => ({
        id: e.id,
        area: e.area_label,
        category: e.category,
        message: e.error_message,
        kind: e.last_error_kind,
        attempts: e.attempts,
        at: e.last_attempt_at,
      })),
    },
    budget: {
      configuredEur: Number(settings?.places_daily_budget_eur ?? 0),
      alertEmail: settings?.alert_email ?? null,
      // Automation only — these are the numbers that count against the cap
      todayCalls: todayUsageAuto?.calls ?? 0,
      todayCostEur: Number(todayUsageAuto?.estimated_cost_eur ?? 0),
      // Manual searches: tracked for visibility, NEVER capped
      manualCalls: todayUsageManual?.calls ?? 0,
      manualCostEur: Number(todayUsageManual?.estimated_cost_eur ?? 0),
    },
    alerts: {
      last24h: alertsLast24h ?? 0,
    },
    recentEvents: recentEvents ?? [],
    activeCampaigns: activeCampaigns ?? [],
  });
}
