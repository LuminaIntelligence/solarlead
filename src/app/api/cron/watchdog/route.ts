/**
 * GET /api/cron/watchdog
 *
 * Watchdog that runs every 10 minutes via GitHub Actions cron.
 * Fixes three types of stuck states:
 *
 * 1. Stuck campaigns: status="running" but updated_at older than 30 min
 *    → mark as "completed"
 *
 * 2. Stuck enrichments: lead status="enriching" but updated_at older than 15 min
 *    → reset to "pending_enrichment" so they can be picked up again
 *
 * 3. Orphaned pending leads: campaign is "completed" but has pending_enrichment leads
 *    → spawn enrichment worker
 *
 * Secured with CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichDiscoveryLead } from "@/lib/discovery/enricher";

export async function GET(req: NextRequest) {
  // Verify secret
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const report: Record<string, unknown> = { timestamp: now.toISOString() };

  // ── Fix 1: Stuck campaigns (running > 30 min without update) ──────────────
  // IMPORTANT: in the cell-based architecture, a running campaign without
  // recent updates is normal — it's waiting for the next cron-tick to claim
  // a cell, possibly paused by daily budget. We only auto-complete if all
  // cells are in a terminal state (done/no_results/error/paused). If any
  // pending/searching cells exist, leave the campaign alone — it WILL
  // continue progressing on the next tick.
  const stuckCampaignThreshold = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const { data: stuckCampaigns } = await supabase
    .from("discovery_campaigns")
    .select("id, name, updated_at")
    .eq("status", "running")
    .lt("updated_at", stuckCampaignThreshold);

  let fixedCampaigns = 0;
  let skippedCampaigns = 0;
  for (const c of stuckCampaigns ?? []) {
    // Check if there are any non-terminal cells. If yes, skip — campaign is
    // legitimately progressing, just slowly.
    const { count: openCells } = await supabase
      .from("search_cells")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .in("status", ["pending", "searching"]);

    if ((openCells ?? 0) > 0) {
      skippedCampaigns++;
      continue;
    }

    // Truly done: all cells are terminal. Mark complete, clear any stale
    // error_message from previous watchdog runs.
    await supabase
      .from("discovery_campaigns")
      .update({
        status: "completed",
        completed_at: now.toISOString(),
        updated_at: now.toISOString(),
        error_message: null,
      })
      .eq("id", c.id);
    fixedCampaigns++;
    console.log(`[Watchdog] Finalized completed campaign: ${c.name} (${c.id})`);
  }
  report.fixed_campaigns = fixedCampaigns;
  report.skipped_campaigns_with_open_cells = skippedCampaigns;

  // ── Fix 2: Stuck enriching leads (enriching > 15 min) ────────────────────
  const stuckEnrichThreshold = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const { data: stuckEnriching } = await supabase
    .from("discovery_leads")
    .update({ status: "pending_enrichment", updated_at: now.toISOString() })
    .eq("status", "enriching")
    .lt("updated_at", stuckEnrichThreshold)
    .select("id");

  const resetLeads = stuckEnriching?.length ?? 0;
  report.reset_enriching_leads = resetLeads;
  if (resetLeads > 0) {
    console.log(`[Watchdog] Reset ${resetLeads} stuck 'enriching' leads to pending_enrichment`);
  }

  // ── Fix 3: Completed campaigns with orphaned pending_enrichment leads ──────
  const { data: pendingLeads } = await supabase
    .from("discovery_leads")
    .select("id, campaign_id")
    .eq("status", "pending_enrichment")
    .order("created_at", { ascending: true })
    .limit(50); // Max 50 per watchdog run to avoid overload

  const campaignIds = [...new Set((pendingLeads ?? []).map((l) => l.campaign_id))];

  // Only trigger for non-running campaigns (running ones have their own worker)
  let queuedLeads = 0;
  if (campaignIds.length > 0) {
    const { data: activeCampaigns } = await supabase
      .from("discovery_campaigns")
      .select("id")
      .in("id", campaignIds)
      .eq("status", "running");

    const activeIds = new Set((activeCampaigns ?? []).map((c) => c.id));
    const orphanedLeads = (pendingLeads ?? []).filter((l) => !activeIds.has(l.campaign_id));

    if (orphanedLeads.length > 0) {
      queuedLeads = orphanedLeads.length;
      console.log(`[Watchdog] Queuing ${queuedLeads} orphaned leads for enrichment`);

      // Fire-and-forget staggered enrichment
      const ids = orphanedLeads.map((l) => l.id);
      setImmediate(async () => {
        for (let i = 0; i < ids.length; i++) {
          try {
            await enrichDiscoveryLead(ids[i]);
          } catch (e) {
            console.warn(`[Watchdog] Enrichment failed for ${ids[i]}:`, e);
          }
          if (i < ids.length - 1) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        console.log(`[Watchdog] Finished enriching ${ids.length} orphaned leads`);
      });
    }
  }
  report.queued_orphaned_leads = queuedLeads;

  console.log("[Watchdog] Run complete:", report);
  return NextResponse.json({ ok: true, ...report });
}
