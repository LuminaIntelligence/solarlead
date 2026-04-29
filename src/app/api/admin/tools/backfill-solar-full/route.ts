/**
 * POST /api/admin/tools/backfill-solar-full
 *
 * Calls Google Solar API for all leads missing detailed solar data.
 * Processes BATCH_SIZE leads per request — call repeatedly until remaining === 0.
 *
 * 404 responses (no building data at coordinates) are treated as permanent
 * "no coverage" and receive a placeholder assessment so they leave the queue.
 * Only use DELETE to reset and retry no-coverage leads.
 *
 * GET returns the count of leads needing full solar backfill.
 * DELETE clears all placeholder records (including no-coverage) for a full retry.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleSolarProvider } from "@/lib/providers/solar/googleSolar";
import { OsmPvgisProvider } from "@/lib/providers/solar/osmPvgis";

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

/**
 * Returns all lead IDs that still need full solar data.
 * "Done" = has a complete assessment (non-null panels) OR a no-coverage placeholder
 * (provider = "no_coverage").  Both types leave the queue permanently.
 */
async function getIncompleteLeads(adminSupabase: ReturnType<typeof createAdminClient>) {
  const allLeads = await fetchAllPages<{ id: string; latitude: number; longitude: number }>(
    adminSupabase,
    "solar_lead_mass",
    "id, latitude, longitude",
    (q) => q.not("latitude", "is", null).not("longitude", "is", null)
  );

  if (!allLeads.length) return [];

  // Leads are "done" when they have a complete assessment OR a permanent no-coverage marker.
  const [completeAssessments, noCoverageMarkers] = await Promise.all([
    fetchAllPages<{ lead_id: string }>(
      adminSupabase,
      "solar_assessments",
      "lead_id",
      (q) => q.not("max_array_panels_count", "is", null)
    ),
    fetchAllPages<{ lead_id: string }>(
      adminSupabase,
      "solar_assessments",
      "lead_id",
      (q) => q.eq("provider", "no_coverage")
    ),
  ]);

  const doneIds = new Set([
    ...completeAssessments.map((a) => a.lead_id),
    ...noCoverageMarkers.map((a) => a.lead_id),
  ]);

  return allLeads.filter((l) => !doneIds.has(l.id));
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  const [incomplete, allPartialRecords, noCoverageRecords] = await Promise.all([
    getIncompleteLeads(adminSupabase),
    fetchAllPages<{ lead_id: string }>(
      adminSupabase,
      "solar_assessments",
      "lead_id",
      (q) => q.is("max_array_panels_count", null).neq("provider", "no_coverage")
    ),
    fetchAllPages<{ lead_id: string }>(
      adminSupabase,
      "solar_assessments",
      "lead_id",
      (q) => q.eq("provider", "no_coverage")
    ),
  ]);

  const noCoverageCount = noCoverageRecords.length;
  const incompleteIdSet = new Set(incomplete.map((l) => l.id));
  const partialIds = new Set(
    allPartialRecords.map((r) => r.lead_id).filter((id) => incompleteIdSet.has(id))
  );
  const partial = incomplete.filter((l) => partialIds.has(l.id)).length;
  const missing = incomplete.filter((l) => !partialIds.has(l.id)).length;

  return NextResponse.json({
    partial,
    missing,
    total: incomplete.length,
    noCoverage: noCoverageCount,
  });
}

/**
 * DELETE — clears all placeholder records (null panels + no-coverage markers)
 * so they re-enter the queue for a full retry.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { error, count } = await adminSupabase
    .from("solar_assessments")
    .delete({ count: "exact" })
    .is("max_array_panels_count", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count ?? 0 });
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
  const fallbackProvider = new OsmPvgisProvider();

  // Get all incomplete leads, take a batch
  const incomplete = await getIncompleteLeads(adminSupabase);
  const remaining_before = incomplete.length;

  if (remaining_before === 0) {
    return NextResponse.json({
      processed: 0,
      failed: 0,
      noCoverage: 0,
      remaining: 0,
      message: "Alle Leads haben vollständige Solar-Daten.",
    });
  }

  const batch = incomplete.slice(0, BATCH_SIZE);

  let processed = 0;
  let processedFallback = 0; // enriched via OSM+PVGIS (no Google coverage)
  let failed = 0;
  let noCoverage = 0;
  let rateLimited = false;
  let firstError: string | null = null;

  for (const lead of batch) {
    try {
      const result = await provider.assess({
        latitude: lead.latitude as number,
        longitude: lead.longitude as number,
      });

      if (!result || !result.max_array_panels_count) {
        // Google Solar returned null (network error) or no panel data (building found
        // but no usable solar potential calculated). Try OSM+PVGIS fallback before
        // giving up — same chain as for 404.
        let usedFallback = false;
        try {
          const fallbackResult = await fallbackProvider.assess({
            latitude: lead.latitude as number,
            longitude: lead.longitude as number,
          });
          if (fallbackResult && fallbackResult.max_array_panels_count) {
            await adminSupabase.from("solar_assessments").delete()
              .eq("lead_id", lead.id).is("max_array_panels_count", null);
            await adminSupabase.from("solar_assessments").insert({
              lead_id: lead.id,
              provider: "osm_pvgis",
              latitude: lead.latitude ?? 0,
              longitude: lead.longitude ?? 0,
              solar_quality: fallbackResult.solar_quality,
              max_array_panels_count: fallbackResult.max_array_panels_count,
              max_array_area_m2: fallbackResult.max_array_area_m2,
              annual_energy_kwh: fallbackResult.annual_energy_kwh,
              sunshine_hours: fallbackResult.sunshine_hours,
              carbon_offset: fallbackResult.carbon_offset,
              segment_count: fallbackResult.segment_count,
              panel_capacity_watts: fallbackResult.panel_capacity_watts,
              raw_response_json: fallbackResult.raw_response_json,
            });
            processedFallback++;
            usedFallback = true;
          }
        } catch (fe) {
          console.warn(`[SolarBackfillFull] OSM+PVGIS fallback (no-panels) failed for ${lead.id}:`,
            fe instanceof Error ? fe.message : fe);
        }
        if (!usedFallback) {
          // Neither source has usable data — mark permanently so it leaves the queue
          await adminSupabase.from("solar_assessments").delete()
            .eq("lead_id", lead.id).eq("provider", "no_coverage");
          await adminSupabase.from("solar_assessments").insert({
            lead_id: lead.id,
            provider: "no_coverage",
            latitude: lead.latitude ?? 0,
            longitude: lead.longitude ?? 0,
            solar_quality: "UNKNOWN",
            max_array_panels_count: null,
          });
          noCoverage++;
        }
        continue;
      }

      // Delete any old incomplete records for this lead, then insert the full one
      await adminSupabase
        .from("solar_assessments")
        .delete()
        .eq("lead_id", lead.id)
        .is("max_array_panels_count", null);

      await adminSupabase.from("solar_assessments").insert({
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
      });

      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[SolarBackfillFull] Failed for lead ${lead.id}:`, msg);

      // Rate limit / auth error — abort the entire batch immediately
      if (
        msg.includes("429") ||
        msg.includes("403") ||
        msg.includes("quota") ||
        msg.includes("rate-limit")
      ) {
        rateLimited = true;
        if (!firstError) firstError = msg;
        break;
      }

      // Google Solar has no coverage for this location (404).
      // Try OSM building footprint + PVGIS irradiance as a free fallback.
      if (msg.includes("404")) {
        let usedFallback = false;
        try {
          const fallbackResult = await fallbackProvider.assess({
            latitude: lead.latitude as number,
            longitude: lead.longitude as number,
          });

          if (fallbackResult && fallbackResult.max_array_panels_count) {
            // Clean up any old incomplete records, then save the fallback assessment
            await adminSupabase
              .from("solar_assessments")
              .delete()
              .eq("lead_id", lead.id)
              .is("max_array_panels_count", null);

            await adminSupabase.from("solar_assessments").insert({
              lead_id: lead.id,
              provider: "osm_pvgis",
              latitude: lead.latitude ?? 0,
              longitude: lead.longitude ?? 0,
              solar_quality: fallbackResult.solar_quality,
              max_array_panels_count: fallbackResult.max_array_panels_count,
              max_array_area_m2: fallbackResult.max_array_area_m2,
              annual_energy_kwh: fallbackResult.annual_energy_kwh,
              sunshine_hours: fallbackResult.sunshine_hours,
              carbon_offset: fallbackResult.carbon_offset,
              segment_count: fallbackResult.segment_count,
              panel_capacity_watts: fallbackResult.panel_capacity_watts,
              raw_response_json: fallbackResult.raw_response_json,
            });

            processedFallback++;
            usedFallback = true;
          }
        } catch (fallbackErr) {
          console.warn(
            `[SolarBackfillFull] OSM+PVGIS fallback failed for ${lead.id}:`,
            fallbackErr instanceof Error ? fallbackErr.message : fallbackErr
          );
        }

        if (!usedFallback) {
          // Neither Google Solar nor OSM+PVGIS has data — mark permanently
          await adminSupabase
            .from("solar_assessments")
            .delete()
            .eq("lead_id", lead.id)
            .eq("provider", "no_coverage");

          await adminSupabase.from("solar_assessments").insert({
            lead_id: lead.id,
            provider: "no_coverage",
            latitude: lead.latitude ?? 0,
            longitude: lead.longitude ?? 0,
            solar_quality: "UNKNOWN",
            max_array_panels_count: null,
          });
          noCoverage++;
        }
        continue;
      }

      // All other errors (5xx, unexpected) — soft failure, will be retried
      if (!firstError) firstError = msg;
      failed++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // Recount remaining after this batch
  const stillIncomplete = await getIncompleteLeads(adminSupabase);
  const remaining = stillIncomplete.length;

  let message: string;
  if (rateLimited) {
    message = `API-Kontingent erschöpft nach ${processed} Leads. Bitte morgen weitermachen.`;
  } else {
    const parts: string[] = [];
    if (processed > 0) parts.push(`${processed} Google Solar`);
    if (processedFallback > 0) parts.push(`${processedFallback} via OSM+PVGIS`);
    if (noCoverage > 0) parts.push(`${noCoverage} ohne Abdeckung`);
    if (failed > 0) parts.push(`${failed} Fehler`);
    message = parts.length
      ? `${parts.join(", ")}. Noch ${remaining} ausstehend.`
      : `Keine neuen Daten. Noch ${remaining} ausstehend.`;
  }

  return NextResponse.json({
    processed,
    processedFallback,
    failed,
    noCoverage,
    remaining,
    rateLimited,
    firstError,
    message,
  });
}
