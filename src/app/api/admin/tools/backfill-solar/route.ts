import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * POST /api/admin/tools/backfill-solar
 *
 * Backfills solar_assessments from discovery_leads for all leads that:
 *  - are linked to a discovery_lead (discovery_leads.lead_id IS NOT NULL)
 *  - have roof area data (max_array_area_m2 IS NOT NULL)
 *  - do NOT yet have a solar_assessments record
 *
 * No Google Solar API calls — uses already-fetched discovery data only.
 * Safe to run multiple times (INSERT … WHERE NOT EXISTS).
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Step 1: Find all discovery_leads that have solar data but no solar_assessment
  const { data: candidates, error: fetchErr } = await adminSupabase
    .from("discovery_leads")
    .select("lead_id, latitude, longitude, solar_quality, max_array_area_m2, roof_area_m2")
    .not("lead_id", "is", null)
    .not("max_array_area_m2", "is", null);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!candidates?.length) {
    return NextResponse.json({ fixed: 0, message: "Keine Discovery-Leads mit Solar-Daten gefunden." });
  }

  // Step 2: Filter to only those missing a solar_assessment
  const leadIds = candidates.map((c) => c.lead_id as string);

  const { data: existing } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", leadIds);

  const existingIds = new Set((existing ?? []).map((e) => e.lead_id));
  const toInsert = candidates.filter((c) => !existingIds.has(c.lead_id));

  if (toInsert.length === 0) {
    return NextResponse.json({
      fixed: 0,
      message: "Alle Discovery-Leads haben bereits eine Solar-Bewertung.",
    });
  }

  // Step 3: Bulk insert in batches of 200 to stay within Supabase limits
  const BATCH = 200;
  let totalInserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map((dl) => ({
      lead_id: dl.lead_id as string,
      provider: "google_solar",
      latitude: dl.latitude ?? 0,
      longitude: dl.longitude ?? 0,
      solar_quality: dl.solar_quality,
      max_array_area_m2: dl.max_array_area_m2,
      // Detailed fields (panels, energy etc.) remain null — user can re-run
      // individual solar analysis from the lead detail page to fill them.
    }));

    const { error: insertErr } = await adminSupabase
      .from("solar_assessments")
      .insert(batch);

    if (insertErr) {
      errors.push(`Batch ${i / BATCH + 1}: ${insertErr.message}`);
    } else {
      totalInserted += batch.length;
    }
  }

  return NextResponse.json({
    fixed: totalInserted,
    skipped: existingIds.size,
    errors: errors.slice(0, 5),
    message: `${totalInserted} Solar-Bewertungen erfolgreich rückgefüllt.`,
  });
}

/**
 * GET /api/admin/tools/backfill-solar
 * Returns how many leads are missing solar assessments (preview before running).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  const { data: candidates } = await adminSupabase
    .from("discovery_leads")
    .select("lead_id")
    .not("lead_id", "is", null)
    .not("max_array_area_m2", "is", null);

  const leadIds = (candidates ?? []).map((c) => c.lead_id as string);

  if (!leadIds.length) {
    return NextResponse.json({ missing: 0, total: 0 });
  }

  const { data: existing } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", leadIds);

  const existingIds = new Set((existing ?? []).map((e) => e.lead_id));
  const missing = leadIds.filter((id) => !existingIds.has(id)).length;

  return NextResponse.json({ missing, total: leadIds.length });
}
