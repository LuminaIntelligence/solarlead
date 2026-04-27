/**
 * Solar Detection Backfill — Admin Tool
 *
 * Iterates through all leads (solar_lead_mass) that are not yet marked as
 * existing_solar and checks OpenStreetMap for existing rooftop solar panels.
 * Detected leads are automatically marked as existing_solar.
 *
 * GET  — Returns the total number of leads eligible for checking
 * POST — Processes one batch (offset + limit)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkExistingSolarOsm } from "@/lib/providers/mastr/overpass";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// GET — how many leads can still be checked
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { count } = await admin
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("status", "eq", "existing_solar")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  return NextResponse.json({ total: count ?? 0 });
}

// POST — process one batch
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset: number = typeof body.offset === "number" ? body.offset : 0;
  const limit: number =
    typeof body.limit === "number"
      ? Math.min(body.limit, 50)
      : 20;

  const admin = createAdminClient();

  // Fetch batch ordered by id for stable pagination
  const { data: leads, error } = await admin
    .from("solar_lead_mass")
    .select("id, latitude, longitude, company_name")
    .not("status", "eq", "existing_solar")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("id")
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const batch = leads ?? [];
  let detected = 0;

  for (const lead of batch) {
    if (!lead.latitude || !lead.longitude) continue;

    const result = await checkExistingSolarOsm(lead.latitude, lead.longitude);

    if (result.hasSolar) {
      await admin
        .from("solar_lead_mass")
        .update({
          status: "existing_solar",
          updated_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
      detected++;
      console.log(
        `[SolarDetection] Marked as existing_solar: ${lead.company_name} (OSM count: ${result.count})`
      );
    }

    // Small pause between Overpass requests to be a good API citizen
    if (batch.indexOf(lead) < batch.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Remaining count after this batch (some may have been marked existing_solar)
  const { count: remaining } = await admin
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("status", "eq", "existing_solar")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  return NextResponse.json({
    processed: batch.length,
    detected,
    remaining: remaining ?? 0,
    nextOffset: offset + batch.length,
  });
}
