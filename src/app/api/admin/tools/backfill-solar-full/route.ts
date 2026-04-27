/**
 * POST /api/admin/tools/backfill-solar-full
 *
 * Calls Google Solar API for all leads that are missing detailed solar data
 * (max_array_panels_count IS NULL) but have coordinates.
 *
 * Processes in batches of 10 per request — call repeatedly with `offset` until
 * `remaining === 0`.
 *
 * GET returns the count of leads needing full solar backfill.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleSolarProvider } from "@/lib/providers/solar/googleSolar";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

const BATCH_SIZE = 10;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Count leads with partial solar assessments (missing panel count)
  const { data: partial } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .is("max_array_panels_count", null);

  // Count leads with no solar assessment at all but having coordinates
  const { data: noAssessment } = await adminSupabase
    .from("solar_lead_mass")
    .select("id")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  const noAssessmentIds = (noAssessment ?? []).map((l) => l.id);
  const { data: existing } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", noAssessmentIds.length > 0 ? noAssessmentIds : ["00000000-0000-0000-0000-000000000000"]);

  const existingIds = new Set((existing ?? []).map((e) => e.lead_id));
  const missingCount = noAssessmentIds.filter((id) => !existingIds.has(id)).length;

  return NextResponse.json({
    partial: partial?.length ?? 0,
    missing: missingCount,
    total: (partial?.length ?? 0) + missingCount,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset = Number(body.offset ?? 0);

  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_SOLAR_API_KEY not set" }, { status: 500 });
  }

  const adminSupabase = createAdminClient();
  const provider = new GoogleSolarProvider(apiKey);

  // 1. Find leads with partial solar assessments (have record but missing panels)
  const { data: partialAssessments } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id, latitude, longitude")
    .is("max_array_panels_count", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .range(offset, offset + BATCH_SIZE - 1);

  // 2. Also find leads with NO assessment but with coordinates
  const { data: allLeads } = await adminSupabase
    .from("solar_lead_mass")
    .select("id, latitude, longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  const partialIds = new Set((partialAssessments ?? []).map((a) => a.lead_id));

  const { data: existingAssessments } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", (allLeads ?? []).map((l) => l.id).length > 0
      ? (allLeads ?? []).map((l) => l.id)
      : ["00000000-0000-0000-0000-000000000000"]);

  const existingIds = new Set((existingAssessments ?? []).map((e) => e.lead_id));
  const leadsWithoutAssessment = (allLeads ?? [])
    .filter((l) => !existingIds.has(l.id) && !partialIds.has(l.id))
    .slice(0, BATCH_SIZE - (partialAssessments?.length ?? 0));

  // Combine both lists
  const toProcess = [
    ...(partialAssessments ?? []).map((a) => ({ lead_id: a.lead_id, latitude: a.latitude, longitude: a.longitude, isPartial: true })),
    ...leadsWithoutAssessment.map((l) => ({ lead_id: l.id, latitude: l.latitude as number, longitude: l.longitude as number, isPartial: false })),
  ].slice(0, BATCH_SIZE);

  if (toProcess.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0, remaining: 0, message: "Alle Leads haben vollständige Solar-Daten." });
  }

  let processed = 0;
  let failed = 0;

  for (const item of toProcess) {
    try {
      const result = await provider.assess({ latitude: item.latitude, longitude: item.longitude });

      if (!result || !result.max_array_panels_count) {
        failed++;
        continue;
      }

      if (item.isPartial) {
        // Update existing partial record
        await adminSupabase
          .from("solar_assessments")
          .update({
            solar_quality: result.solar_quality,
            max_array_panels_count: result.max_array_panels_count,
            max_array_area_m2: result.max_array_area_m2,
            annual_energy_kwh: result.annual_energy_kwh,
            sunshine_hours: result.sunshine_hours,
            carbon_offset: result.carbon_offset,
            segment_count: result.segment_count,
            panel_capacity_watts: result.panel_capacity_watts,
            raw_response_json: result.raw_response_json,
            updated_at: new Date().toISOString(),
          })
          .eq("lead_id", item.lead_id)
          .is("max_array_panels_count", null);
      } else {
        // Insert new assessment
        await adminSupabase
          .from("solar_assessments")
          .insert({
            lead_id: item.lead_id,
            provider: "google_solar",
            latitude: item.latitude,
            longitude: item.longitude,
            solar_quality: result.solar_quality,
            max_array_panels_count: result.max_array_panels_count,
            max_array_area_m2: result.max_array_area_m2,
            annual_energy_kwh: result.annual_energy_kwh,
            sunshine_hours: result.sunshine_hours,
            carbon_offset: result.carbon_offset,
            segment_count: result.segment_count,
            panel_capacity_watts: result.panel_capacity_watts,
            raw_response_json: result.raw_response_json,
          });
      }

      processed++;
    } catch (e) {
      console.warn(`[SolarBackfillFull] Failed for lead ${item.lead_id}:`, e);
      failed++;
    }

    // Small stagger to avoid API rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  // Count remaining
  const { data: stillPartial } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id", { count: "exact", head: true })
    .is("max_array_panels_count", null);

  const remaining = (stillPartial as unknown as { count: number } | null)?.count ?? 0;

  return NextResponse.json({
    processed,
    failed,
    remaining,
    message: `${processed} Leads angereichert, ${failed} fehlgeschlagen.`,
  });
}
