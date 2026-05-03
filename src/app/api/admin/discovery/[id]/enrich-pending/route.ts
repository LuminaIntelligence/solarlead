/**
 * POST /api/admin/discovery/[id]/enrich-pending
 *
 * Picks up all leads stuck in "pending_enrichment" or "enriching" (>15 min)
 * for this campaign and re-runs enrichment in the background.
 *
 * Called when the banner detects no progress for a while.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichDiscoveryLead } from "@/lib/discovery/enricher";

import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id: campaignId } = await params;
  const adminSupabase = createAdminClient();

  // Reset leads stuck in "enriching" for >15 minutes back to pending_enrichment
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await adminSupabase
    .from("discovery_leads")
    .update({ status: "pending_enrichment", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "enriching")
    .lt("updated_at", staleThreshold);

  // Fetch all pending leads
  const { data: pending } = await adminSupabase
    .from("discovery_leads")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "pending_enrichment")
    .order("created_at", { ascending: true });

  const count = pending?.length ?? 0;
  if (count === 0) {
    return NextResponse.json({ queued: 0, message: "Keine ausstehenden Leads." });
  }

  // Fire enrichment in background — staggered to avoid API flood
  const ids = (pending ?? []).map((r) => r.id);
  setImmediate(async () => {
    for (let i = 0; i < ids.length; i++) {
      try {
        await enrichDiscoveryLead(ids[i]);
      } catch (e) {
        console.warn(`[EnrichPending] Failed for ${ids[i]}:`, e);
      }
      if (i < ids.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.log(`[EnrichPending] Finished ${ids.length} leads for campaign ${campaignId}`);
  });

  return NextResponse.json({
    queued: count,
    message: `${count} Lead${count !== 1 ? "s" : ""} wurden zur Anreicherung eingeplant.`,
  });
}
