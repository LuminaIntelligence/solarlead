/**
 * Cron entry point for unattended discovery automation.
 *
 * Triggered by system cron every N minutes via:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/discovery-tick
 *
 * Each tick:
 *   1. Writes a heartbeat (so the dashboard can detect outages)
 *   2. Checks the daily budget cap; if exceeded, alerts and exits
 *   3. Reclaims any stuck 'searching' cells (>10min)
 *   4. Claims and processes up to MAX_CELLS_PER_TICK cells sequentially
 *   5. If a campaign finishes (no more pending cells), marks it 'completed'
 *   6. Returns a summary JSON
 *
 * Safe to call manually for testing — also available via the boost endpoint
 * which is browser-driven.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimNextCell, runCell } from "@/lib/discovery/cell-runner";
import { checkBudgetOk } from "@/lib/discovery/cost-tracker";
import { recordHealth, sendAlertIfFresh } from "@/lib/discovery/health-tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — generous since this runs server-side, not Vercel

const MAX_CELLS_PER_TICK = 3;        // sequential — Google Places rate limits
const TICK_BUDGET_MS = 240_000;       // 4 min — leave 1 min margin
const HARD_TICK_TIMEOUT_MS = 270_000; // 4.5 min — absolute backstop

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  // Accept Authorization: Bearer <secret>
  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${expected}`) return true;

  // Accept x-cron-secret: <secret> (matches existing solar-detection convention)
  if (req.headers.get("x-cron-secret") === expected) return true;

  // Fallback for manual testing: ?secret=...
  if (req.nextUrl.searchParams.get("secret") === expected) return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const adminSupabase = createAdminClient();

  // Heartbeat — ALWAYS write this first so the dashboard knows the cron is alive
  await recordHealth(adminSupabase, {
    source: "discovery_tick",
    kind: "heartbeat",
    message: "tick started",
  });

  // Budget gate: stop early if today's spend would exceed the configured cap.
  const budget = await checkBudgetOk(adminSupabase, "google_places");
  if (!budget.ok) {
    await recordHealth(adminSupabase, {
      source: "discovery_tick",
      kind: "info",
      message: `Budget reached: €${budget.spent.toFixed(2)} of €${budget.budget} — pausing for today`,
      context: budget,
    });

    // Email once per day (dedup handles spam)
    await sendAlertIfFresh(
      adminSupabase,
      "budget_exceeded",
      `Tagesbudget erreicht (€${budget.spent.toFixed(2)})`,
      `Das tägliche Google-Places-Budget von €${budget.budget} ist heute aufgebraucht.\n\n` +
        `Discovery-Tick pausiert bis 00:00 Uhr morgen. Bestehende Kampagnen laufen automatisch weiter.\n\n` +
        `Wenn das Budget gehoben werden soll: Admin → Einstellungen → "Tagesbudget Google Places"`,
      budget
    );

    return NextResponse.json({
      ok: true,
      processed: 0,
      reason: "budget_exceeded",
      budget,
      elapsedMs: Date.now() - startedAt,
    });
  }

  // Process up to MAX_CELLS_PER_TICK cells sequentially within our time budget
  const results: Array<{ cellId: string; outcome: string; placesNew: number; errorKind?: string }> = [];
  let processed = 0;
  let errors = 0;
  let lastErrorKind: string | null = null;

  while (processed < MAX_CELLS_PER_TICK && Date.now() - startedAt < TICK_BUDGET_MS) {
    // Re-check budget mid-tick — long-running ticks could push over the line
    const recheck = await checkBudgetOk(adminSupabase, "google_places");
    if (!recheck.ok) break;

    const cell = await claimNextCell(adminSupabase);
    if (!cell) break; // queue empty

    const cellResult = await runCell(adminSupabase, cell);
    processed++;
    if (cellResult.outcome === "error") {
      errors++;
      lastErrorKind = cellResult.errorKind ?? "other";
    }
    results.push({
      cellId: cell.id,
      outcome: cellResult.outcome,
      placesNew: cellResult.placesNew,
      errorKind: cellResult.errorKind,
    });

    // Hard backstop in case any single cell exceeded its own timeout
    if (Date.now() - startedAt > HARD_TICK_TIMEOUT_MS) break;
  }

  // Finalize any campaign whose last cell we just completed
  await markCompletedCampaigns(adminSupabase);

  // Final heartbeat with results so the dashboard sees the tick succeeded
  await recordHealth(adminSupabase, {
    source: "discovery_tick",
    kind: "heartbeat",
    message: `tick completed: ${processed} cells, ${errors} errors`,
    context: { processed, errors, last_error_kind: lastErrorKind, elapsed_ms: Date.now() - startedAt },
  });

  return NextResponse.json({
    ok: true,
    processed,
    errors,
    results,
    elapsedMs: Date.now() - startedAt,
  });
}

/**
 * Set status='completed' on campaigns whose every cell is in a terminal state.
 */
async function markCompletedCampaigns(adminSupabase: ReturnType<typeof createAdminClient>) {
  // Find running campaigns
  const { data: running } = await adminSupabase
    .from("discovery_campaigns")
    .select("id")
    .eq("status", "running");

  if (!running?.length) return;

  for (const c of running) {
    // Are there ANY non-terminal cells left?
    const { count } = await adminSupabase
      .from("search_cells")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .in("status", ["pending", "searching", "error"]);

    if ((count ?? 0) === 0) {
      await adminSupabase
        .from("discovery_campaigns")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", c.id);

      await recordHealth(adminSupabase, {
        source: "discovery_tick",
        kind: "info",
        message: `Campaign ${c.id} completed: all cells terminal`,
        context: { campaign_id: c.id },
      });
    }
  }
}
