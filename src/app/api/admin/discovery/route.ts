import { NextRequest, NextResponse } from "next/server";
import { generateCells, estimateCellsCostEur } from "@/lib/discovery/cell-generator";
import { recordHealth } from "@/lib/discovery/health-tracker";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/discovery — list all campaigns
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { data: campaigns, error } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ campaigns: [], warning: "Tabellen noch nicht angelegt." });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: campaigns ?? [] });
}

// POST /api/admin/discovery — create campaign + generate cells.
// Cells are processed asynchronously by /api/cron/discovery-tick (every 5 min)
// and on-demand by /api/admin/tools/discovery-run (browser boost).
//
// This endpoint does NOT do any actual searching — it just enqueues work.
// That makes campaign creation fast and resilient: even if the request times
// out, the cells are persisted and will be picked up by the next tick.
export async function POST(req: NextRequest) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const body = await req.json();
  const { name, description, areas, categories, search_keyword, auto_approve_threshold } = body;

  if (!name || !areas?.length || !categories?.length) {
    return NextResponse.json({ error: "Name, Gebiete und Branchen sind erforderlich" }, { status: 400 });
  }

  // Create the campaign — status='running' immediately so the cron picks it up.
  const { data: campaign, error } = await supabase
    .from("discovery_campaigns")
    .insert({
      created_by: user!.id,
      name,
      description: description ?? null,
      areas,
      categories,
      search_keyword: search_keyword || null,
      auto_approve_threshold: auto_approve_threshold ?? 70,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Generate the search cells (one per area × category combination) and bulk
  // insert via the service-role client to bypass RLS.
  const cells = generateCells({
    campaign_id: campaign.id,
    areas,
    categories,
    search_keyword: search_keyword || null,
  });
  const estimatedCostEur = estimateCellsCostEur(cells);

  if (cells.length === 0) {
    return NextResponse.json({ error: "Cell-Generator hat keine Cells erzeugt" }, { status: 500 });
  }

  const adminSupabase = createAdminClient();
  const { error: cellErr } = await adminSupabase.from("search_cells").insert(cells);
  if (cellErr) {
    // Roll back the campaign so we don't leak a half-created run
    await supabase.from("discovery_campaigns").delete().eq("id", campaign.id);
    return NextResponse.json({ error: `Cells anlegen fehlgeschlagen: ${cellErr.message}` }, { status: 500 });
  }

  await recordHealth(adminSupabase, {
    source: "campaign_create",
    kind: "info",
    message: `Kampagne '${name}' erstellt mit ${cells.length} Cells (~€${estimatedCostEur.toFixed(2)} geschätzt)`,
    context: {
      campaign_id: campaign.id,
      cells: cells.length,
      estimated_cost_eur: Number(estimatedCostEur.toFixed(2)),
      areas: areas.length,
      categories: categories.length,
    },
  });

  return NextResponse.json(
    {
      campaign,
      cells_generated: cells.length,
      estimated_cost_eur: Number(estimatedCostEur.toFixed(2)),
    },
    { status: 201 }
  );
}
