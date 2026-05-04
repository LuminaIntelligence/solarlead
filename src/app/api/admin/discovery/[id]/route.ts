import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";

// GET /api/admin/discovery/[id] — campaign detail + paginated leads
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") ?? "";
  const solarComplete = searchParams.get("solar_complete") === "1";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = 50;

  const { data: campaign, error: campErr } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .eq("id", id)
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  // If filtering by complete solar data, fetch qualifying lead_ids first
  let solarCompleteLeadIds: string[] | null = null;
  if (solarComplete) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const adminClient = createAdminClient();
    const { data: completeAssessments } = await adminClient
      .from("solar_assessments")
      .select("lead_id")
      .not("max_array_panels_count", "is", null);
    solarCompleteLeadIds = (completeAssessments ?? []).map((a: { lead_id: string }) => a.lead_id);
  }

  let leadsQuery = supabase
    .from("discovery_leads")
    .select("*", { count: "exact" })
    .eq("campaign_id", id)
    .order("total_score", { ascending: false, nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (statusFilter) {
    leadsQuery = leadsQuery.eq("status", statusFilter);
  }

  // Always exclude discovery_leads where the linked lead is marked as existing_solar
  const { data: existingSolarLeads } = await supabase
    .from("solar_lead_mass")
    .select("id")
    .eq("status", "existing_solar");
  if (existingSolarLeads?.length) {
    const excludeIds = existingSolarLeads.map((l: { id: string }) => l.id);
    leadsQuery = leadsQuery.not("lead_id", "in", `(${excludeIds.join(",")})`);
  }

  if (solarCompleteLeadIds !== null) {
    // If no complete leads exist, use a dummy UUID to return empty results
    const ids = solarCompleteLeadIds.length > 0
      ? solarCompleteLeadIds
      : ["00000000-0000-0000-0000-000000000000"];
    leadsQuery = leadsQuery.in("lead_id", ids);
  }

  // Count leads still waiting for enrichment + per-cell-status breakdown
  const cellStatusQuery = (status: string) =>
    supabase
      .from("search_cells")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .eq("status", status);

  const [
    leadsResult, pendingResult, enrichingResult,
    cellPending, cellSearching, cellDone, cellNoResults, cellError, cellPaused,
    lastTickResult,
  ] = await Promise.all([
    leadsQuery,
    supabase.from("discovery_leads").select("id", { count: "exact", head: true })
      .eq("campaign_id", id).eq("status", "pending_enrichment"),
    supabase.from("discovery_leads").select("id", { count: "exact", head: true })
      .eq("campaign_id", id).eq("status", "enriching"),
    cellStatusQuery("pending"),
    cellStatusQuery("searching"),
    cellStatusQuery("done"),
    cellStatusQuery("no_results"),
    cellStatusQuery("error"),
    cellStatusQuery("paused"),
    // Most recent search_cell activity for THIS campaign
    supabase.from("search_cells")
      .select("last_attempt_at, area_label, category, status, error_message")
      .eq("campaign_id", id)
      .not("last_attempt_at", "is", null)
      .order("last_attempt_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error.message }, { status: 500 });

  const enrichmentPending = (pendingResult.count ?? 0) + (enrichingResult.count ?? 0);

  const cellStats = {
    pending: cellPending.count ?? 0,
    searching: cellSearching.count ?? 0,
    done: cellDone.count ?? 0,
    no_results: cellNoResults.count ?? 0,
    error: cellError.count ?? 0,
    paused: cellPaused.count ?? 0,
    total:
      (cellPending.count ?? 0) +
      (cellSearching.count ?? 0) +
      (cellDone.count ?? 0) +
      (cellNoResults.count ?? 0) +
      (cellError.count ?? 0) +
      (cellPaused.count ?? 0),
  };

  return NextResponse.json({
    campaign,
    leads: leadsResult.data ?? [],
    total: leadsResult.count ?? 0,
    page,
    pageSize,
    enrichmentPending,
    cellStats,
    lastCellActivity: lastTickResult.data ?? null,
  });
}

// PATCH /api/admin/discovery/[id] — update campaign (pause/resume/threshold)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id } = await params;
  const body = await req.json();
  const allowed = ["status", "auto_approve_threshold", "name", "description"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from("discovery_campaigns")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}

// DELETE /api/admin/discovery/[id] — only if pending or failed
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id } = await params;
  const { data: campaign } = await supabase
    .from("discovery_campaigns")
    .select("status")
    .eq("id", id)
    .single();

  if (!campaign) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!["pending", "failed", "completed"].includes(campaign.status)) {
    return NextResponse.json({ error: "Laufende Kampagnen können nicht gelöscht werden" }, { status: 409 });
  }

  await supabase.from("discovery_campaigns").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
