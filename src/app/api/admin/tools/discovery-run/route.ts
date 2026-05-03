/**
 * Discovery Boost Endpoint — browser-driven manual run.
 *
 * Same logic as /api/cron/discovery-tick, but:
 *   - Authenticated via requireAdminAndOrigin (admin session + same-origin)
 *   - Returns sooner (60s budget) so the UI sees frequent progress updates
 *   - Frontend calls this in a loop while the user has the dashboard open
 *
 * Both this endpoint AND the cron endpoint operate on the same search_cells
 * table — they cooperate via DB locking, no risk of duplicates.
 */
import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { claimNextCell, runCell } from "@/lib/discovery/cell-runner";
import { checkBudgetOk } from "@/lib/discovery/cost-tracker";
import { recordHealth } from "@/lib/discovery/health-tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TIME_BUDGET_MS = 60_000;
const MAX_CELLS_PER_CALL = 2;

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { adminSupabase } = gate;

  const startedAt = Date.now();

  // Heartbeat under a separate source so we can distinguish manual runs
  await recordHealth(adminSupabase, {
    source: "discovery_boost",
    kind: "heartbeat",
    message: "boost started",
  });

  // Budget guard
  const budget = await checkBudgetOk(adminSupabase, "google_places");
  if (!budget.ok) {
    return NextResponse.json({
      idle: false,
      processed: 0,
      reason: "budget_exceeded",
      budget,
      elapsedMs: Date.now() - startedAt,
    });
  }

  let processed = 0;
  let errors = 0;
  let placesNewTotal = 0;
  const recentResults: Array<{ outcome: string; placesNew: number; errorKind?: string }> = [];

  while (processed < MAX_CELLS_PER_CALL && Date.now() - startedAt < TIME_BUDGET_MS) {
    const cell = await claimNextCell(adminSupabase);
    if (!cell) {
      // Queue truly empty
      return NextResponse.json({
        idle: true,
        processed,
        errors,
        placesNewTotal,
        recentResults,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const result = await runCell(adminSupabase, cell);
    processed++;
    placesNewTotal += result.placesNew;
    if (result.outcome === "error") errors++;
    recentResults.push({
      outcome: result.outcome,
      placesNew: result.placesNew,
      errorKind: result.errorKind,
    });
  }

  return NextResponse.json({
    idle: false,
    processed,
    errors,
    placesNewTotal,
    recentResults,
    elapsedMs: Date.now() - startedAt,
  });
}
