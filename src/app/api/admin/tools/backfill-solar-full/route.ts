/**
 * POST /api/admin/tools/backfill-solar-full
 *
 * Calls Google Solar API for all leads missing detailed solar data.
 * Processes BATCH_SIZE leads per request — call repeatedly until remaining === 0.
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

/** Fetch all rows from a table with pagination (bypasses Supabase 1000-row default limit) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages<T>(
  adminSupabase: ReturnType<typeof createAdminClient>,
  table: string,
  select: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: (q: any) => any
): Promise<T[]> {
  const PAGE = 1000;
  const results: T[] = [];
  let offset = 0;
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (adminSupabase.from(table) as any).select(select).range(offset, offset + PAGE - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error || !data?.length) break;
    results.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return results;
}

/** Returns all lead IDs that still need full solar data */
async function getIncompleteLeads(adminSupabase: ReturnType<typeof createAdminClient>) {
  // All leads with coordinates — paginated to get past 1000-row limit
  const allLeads = await fetchAllPages<{ id: string; latitude: number; longitude: number }>(
    adminSupabase,
    "solar_lead_mass",
    "id, latitude, longitude",
    (q) => q.not("latitude", "is", null).not("longitude", "is", null)
  );

  if (!allLeads.length) return [];

  const allIds = allLeads.map((l) => l.id);

  // All assessments that have panel data (= complete) — also paginated
  const completeAssessments = await fetchAllPages<{ lead_id: string }>(
    adminSupabase,
    "solar_assessments",
    "lead_id",
    (q) => q.in("lead_id", allIds).not("max_array_panels_count", "is", null)
  );

  const completeIds = new Set(completeAssessments.map((a) => a.lead_id));

  // Return leads that are NOT complete
  return allLeads.filter((l) => !completeIds.has(l.id));
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const incomplete = await getIncompleteLeads(adminSupabase);

  // Split into partial (have record but missing panels) vs. none
  const { data: partialRecords } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", incomplete.length > 0 ? incomplete.map((l) => l.id) : ["00000000-0000-0000-0000-000000000000"])
    .is("max_array_panels_count", null);

  const partialIds = new Set((partialRecords ?? []).map((r) => r.lead_id));
  const partial = incomplete.filter((l) => partialIds.has(l.id)).length;
  const missing = incomplete.filter((l) => !partialIds.has(l.id)).length;

  return NextResponse.json({ partial, missing, total: incomplete.length });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_SOLAR_API_KEY not set" }, { status: 500 });
  }

  const adminSupabase = createAdminClient();
  const provider = new GoogleSolarProvider(apiKey);

  // Get all incomplete leads, take a batch
  const incomplete = await getIncompleteLeads(adminSupabase);
  const remaining_before = incomplete.length;

  if (remaining_before === 0) {
    return NextResponse.json({ processed: 0, failed: 0, remaining: 0, message: "Alle Leads haben vollständige Solar-Daten." });
  }

  const batch = incomplete.slice(0, BATCH_SIZE);

  // Find which ones already have a partial record
  const { data: partialRecords } = await adminSupabase
    .from("solar_assessments")
    .select("lead_id")
    .in("lead_id", batch.map((l) => l.id))
    .is("max_array_panels_count", null);

  const partialIds = new Set((partialRecords ?? []).map((r) => r.lead_id));

  let processed = 0;
  let failed = 0;

  for (const lead of batch) {
    try {
      const result = await provider.assess({ latitude: lead.latitude as number, longitude: lead.longitude as number });

      if (!result || !result.max_array_panels_count) {
        // API returned no panel data — mark as failed but still count as "processed" to avoid infinite loop
        failed++;
        // Insert a placeholder so this lead isn't retried endlessly
        if (!partialIds.has(lead.id)) {
          await adminSupabase.from("solar_assessments").upsert({
            lead_id: lead.id,
            provider: "google_solar",
            latitude: lead.latitude ?? 0,
            longitude: lead.longitude ?? 0,
            solar_quality: result?.solar_quality ?? "UNKNOWN",
            max_array_area_m2: result?.max_array_area_m2 ?? null,
          }, { onConflict: "lead_id" });
        }
        continue;
      }

      const assessmentData = {
        lead_id: lead.id,
        provider: "google_solar",
        latitude: lead.latitude ?? 0,
        longitude: lead.longitude ?? 0,
        solar_quality: result.solar_quality,
        max_array_panels_count: result.max_array_panels_count,
        max_array_area_m2: result.max_array_area_m2,
        annual_energy_kwh: result.annual_energy_kwh,
        sunshine_hours: result.sunshine_hours,
        carbon_offset: result.carbon_offset,
        segment_count: result.segment_count,
        panel_capacity_watts: result.panel_capacity_watts,
        raw_response_json: result.raw_response_json,
      };

      // Delete any existing incomplete records, then insert the full one
      await adminSupabase
        .from("solar_assessments")
        .delete()
        .eq("lead_id", lead.id)
        .is("max_array_panels_count", null);

      await adminSupabase
        .from("solar_assessments")
        .insert(assessmentData);

      processed++;
    } catch (e) {
      console.warn(`[SolarBackfillFull] Failed for lead ${lead.id}:`, e);
      failed++;
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // Recount remaining after this batch
  const stillIncomplete = await getIncompleteLeads(adminSupabase);
  const remaining = stillIncomplete.length;

  return NextResponse.json({
    processed,
    failed,
    remaining,
    message: `${processed} Leads angereichert, ${failed} fehlgeschlagen. Noch ${remaining} ausstehend.`,
  });
}
