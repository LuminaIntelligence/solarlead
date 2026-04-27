import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// GET /api/admin/discovery/[id] — campaign detail + paginated leads
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") ?? "";
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

  let leadsQuery = supabase
    .from("discovery_leads")
    .select("*", { count: "exact" })
    .eq("campaign_id", id)
    .order("total_score", { ascending: false, nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (statusFilter) {
    leadsQuery = leadsQuery.eq("status", statusFilter);
  }

  // Count leads still waiting for enrichment (background progress indicator)
  const [leadsResult, pendingResult, enrichingResult] = await Promise.all([
    leadsQuery,
    supabase
      .from("discovery_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .eq("status", "pending_enrichment"),
    supabase
      .from("discovery_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .eq("status", "enriching"),
  ]);

  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error.message }, { status: 500 });

  const enrichmentPending = (pendingResult.count ?? 0) + (enrichingResult.count ?? 0);

  return NextResponse.json({
    campaign,
    leads: leadsResult.data ?? [],
    total: leadsResult.count ?? 0,
    page,
    pageSize,
    enrichmentPending,
  });
}

// PATCH /api/admin/discovery/[id] — update campaign (pause/resume/threshold)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
