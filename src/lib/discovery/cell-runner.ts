/**
 * Cell Runner — process ONE search_cell end-to-end.
 *
 * Atomic claim → Google Places search → dedupe → insert leads → mark cell done.
 * Errors are categorized so the dashboard can group them. Repeat failures get
 * counted via search_cells.attempts and trigger an email alert at attempt 3.
 *
 * This function is the only one that consumes Google Places quota. Cost
 * tracking is incremented after each call regardless of success.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { GooglePlacesProvider } from "@/lib/providers/search/googlePlaces";
import { enrichDiscoveryLead } from "./enricher";
import { recordApiCalls } from "./cost-tracker";
import { recordHealth, sendAlertIfFresh } from "./health-tracker";

const PER_CELL_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS_BEFORE_ALERT = 3;
const ENRICHMENT_STAGGER_MS = 2000;

export interface ClaimedCell {
  id: string;
  campaign_id: string;
  area_label: string;
  area_type: "city" | "radius";
  area_city: string | null;
  area_lat: number | null;
  area_lng: number | null;
  area_radius_km: number | null;
  category: string;
  search_keyword: string | null;
  attempts: number;
}

/** Categorize an error message for grouping in the dashboard. */
function classifyError(msg: string): "timeout" | "rate_limit" | "auth" | "network" | "other" {
  const m = msg.toLowerCase();
  if (m.includes("timeout") || m.includes("aborted")) return "timeout";
  if (m.includes("429") || m.includes("rate") || m.includes("quota")) return "rate_limit";
  if (m.includes("401") || m.includes("403") || m.includes("api key") || m.includes("forbidden")) return "auth";
  if (m.includes("network") || m.includes("fetch failed") || m.includes("enotfound")) return "network";
  return "other";
}

/** Wrap any promise with a hard timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Atomically claim ONE pending or error cell — race-safe SELECT then conditional UPDATE.
 * Returns null if the queue is empty.
 */
export async function claimNextCell(
  adminSupabase: ReturnType<typeof createAdminClient>
): Promise<ClaimedCell | null> {
  // Reclaim stuck cells (status='searching' >10min) before claiming new ones.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: reclaimed } = await adminSupabase
    .from("search_cells")
    .update({ status: "pending" })
    .eq("status", "searching")
    .lt("last_attempt_at", tenMinAgo)
    .select("id");
  if (reclaimed && reclaimed.length > 0) {
    await recordHealth(adminSupabase, {
      source: "cell_runner",
      kind: "warning",
      message: `Reclaimed ${reclaimed.length} stuck cell(s) (>10min in 'searching')`,
      context: { reclaimed_ids: reclaimed.map((r) => r.id) },
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: candidate } = await adminSupabase
      .from("search_cells")
      .select(
        "id, campaign_id, area_label, area_type, area_city, area_lat, area_lng, area_radius_km, category, search_keyword, attempts"
      )
      .in("status", ["pending", "error"])
      .lt("attempts", MAX_ATTEMPTS_BEFORE_ALERT + 5) // give up after many retries
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!candidate) return null;

    // Race-safe claim: only update if status is still in (pending,error)
    const { data: claimed } = await adminSupabase
      .from("search_cells")
      .update({
        status: "searching",
        last_attempt_at: new Date().toISOString(),
        attempts: (candidate.attempts as number) + 1,
      })
      .eq("id", candidate.id)
      .in("status", ["pending", "error"])
      .select("id, campaign_id, area_label, area_type, area_city, area_lat, area_lng, area_radius_km, category, search_keyword, attempts")
      .maybeSingle();

    if (claimed) {
      return {
        id: claimed.id as string,
        campaign_id: claimed.campaign_id as string,
        area_label: claimed.area_label as string,
        area_type: claimed.area_type as "city" | "radius",
        area_city: (claimed.area_city as string | null) ?? null,
        area_lat: claimed.area_lat as number | null,
        area_lng: claimed.area_lng as number | null,
        area_radius_km: claimed.area_radius_km as number | null,
        category: claimed.category as string,
        search_keyword: claimed.search_keyword as string | null,
        attempts: claimed.attempts as number,
      };
    }
    // Lost race — try next candidate
  }

  return null;
}

export interface CellResult {
  cellId: string;
  outcome: "done" | "no_results" | "error";
  placesFound: number;
  placesNew: number;
  durationMs: number;
  errorMessage?: string;
  errorKind?: string;
}

/**
 * Run a single claimed cell. The cell MUST already be in 'searching' status
 * (the caller's claim should have set this).
 */
export async function runCell(
  adminSupabase: ReturnType<typeof createAdminClient>,
  cell: ClaimedCell
): Promise<CellResult> {
  const startedAt = Date.now();

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return finalizeError(
      adminSupabase,
      cell,
      "GOOGLE_PLACES_API_KEY not set",
      "auth",
      Date.now() - startedAt
    );
  }

  const provider = new GooglePlacesProvider(apiKey);

  try {
    // Google Places search — wrapped in hard timeout to prevent indefinite hangs.
    // Estimate API calls in advance so we can record them even on partial failure.
    const expectedCalls = 12; // ~4 search terms × 3 pages — close enough for budget tracking
    let results;
    if (cell.area_type === "radius" && cell.area_lat != null && cell.area_lng != null && cell.area_radius_km != null) {
      results = await withTimeout(
        provider.searchByCoords(
          cell.area_lat,
          cell.area_lng,
          cell.area_radius_km,
          "DE",
          cell.category,
          cell.search_keyword ?? undefined,
          3
        ),
        PER_CELL_TIMEOUT_MS,
        "places.searchByCoords"
      );
    } else if (cell.area_type === "city" && cell.area_city) {
      results = await withTimeout(
        provider.searchCategoryPaginated(
          cell.area_city,
          "DE",
          cell.category,
          cell.search_keyword ?? undefined,
          3
        ),
        PER_CELL_TIMEOUT_MS,
        "places.searchCategoryPaginated"
      );
    } else {
      throw new Error(`Cell has invalid area config: type=${cell.area_type}`);
    }

    // Record API usage regardless of outcome (rate limits/billing tracking)
    await recordApiCalls(adminSupabase, "google_places", expectedCalls);

    const placesFound = results.length;

    if (placesFound === 0) {
      return finalizeNoResults(adminSupabase, cell, Date.now() - startedAt);
    }

    // Dedup against solar_lead_mass.place_id — paginated to avoid huge IN()
    const placeIds = results.map((r) => r.place_id).filter(Boolean) as string[];
    const existingPlaceIds = new Set<string>();
    if (placeIds.length > 0) {
      // chunk into pages of 200 IDs to keep URL length manageable
      for (let i = 0; i < placeIds.length; i += 200) {
        const slice = placeIds.slice(i, i + 200);
        const { data: existing } = await adminSupabase
          .from("solar_lead_mass")
          .select("place_id")
          .in("place_id", slice);
        for (const e of existing ?? []) {
          if (e.place_id) existingPlaceIds.add(e.place_id as string);
        }
      }
    }

    // Filter dedup, prepare inserts
    const newLeads: Array<Record<string, unknown>> = [];
    for (const r of results) {
      if (r.place_id && existingPlaceIds.has(r.place_id)) continue;
      newLeads.push({
        campaign_id: cell.campaign_id,
        company_name: r.company_name,
        address: r.address ?? "",
        city: r.city,
        postal_code: r.postal_code,
        country: r.country ?? "DE",
        category: cell.category,
        website: r.website,
        phone: r.phone,
        place_id: r.place_id,
        latitude: r.latitude,
        longitude: r.longitude,
        status: "pending_enrichment",
      });
    }

    let placesNew = 0;
    let insertedIds: string[] = [];
    if (newLeads.length > 0) {
      const { data: inserted, error: insertErr } = await adminSupabase
        .from("discovery_leads")
        .insert(newLeads)
        .select("id");

      if (insertErr) {
        return finalizeError(
          adminSupabase,
          cell,
          `discovery_leads insert: ${insertErr.message}`,
          classifyError(insertErr.message),
          Date.now() - startedAt
        );
      }
      placesNew = inserted?.length ?? 0;
      insertedIds = (inserted ?? []).map((row) => row.id as string);

      // Update campaign counters
      await bumpCampaignCounters(
        adminSupabase,
        cell.campaign_id,
        placesNew,
        placesFound - placesNew
      );
    }

    // Fire-and-forget enrichment for newly inserted leads. We don't await
    // because each enrichment is itself slow (~10-30s) and must not block
    // the cell from completing. Enrichment failures are logged but tolerated.
    if (insertedIds.length > 0) {
      void runEnrichmentInBackground(insertedIds);
    }

    return finalizeDone(adminSupabase, cell, placesFound, placesNew, Date.now() - startedAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = classifyError(msg);
    return finalizeError(adminSupabase, cell, msg, kind, Date.now() - startedAt);
  }
}

/** Background-fire enrichment for newly inserted leads with a stagger. */
function runEnrichmentInBackground(leadIds: string[]): void {
  setImmediate(async () => {
    for (let i = 0; i < leadIds.length; i++) {
      try {
        await enrichDiscoveryLead(leadIds[i]);
      } catch (e) {
        console.warn(`[CellRunner] Enrichment failed for ${leadIds[i]}:`, e);
      }
      if (i < leadIds.length - 1) {
        await new Promise((r) => setTimeout(r, ENRICHMENT_STAGGER_MS));
      }
    }
  });
}

async function bumpCampaignCounters(
  adminSupabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  newCount: number,
  duplicates: number
) {
  const { data: camp } = await adminSupabase
    .from("discovery_campaigns")
    .select("total_discovered, total_duplicates")
    .eq("id", campaignId)
    .maybeSingle();
  if (!camp) return;
  await adminSupabase
    .from("discovery_campaigns")
    .update({
      total_discovered: (camp.total_discovered ?? 0) + newCount,
      total_duplicates: (camp.total_duplicates ?? 0) + duplicates,
    })
    .eq("id", campaignId);
}

async function finalizeDone(
  adminSupabase: ReturnType<typeof createAdminClient>,
  cell: ClaimedCell,
  placesFound: number,
  placesNew: number,
  durationMs: number
): Promise<CellResult> {
  await adminSupabase
    .from("search_cells")
    .update({
      status: "done",
      places_found: placesFound,
      places_new: placesNew,
      duration_ms: durationMs,
      error_message: null,
      last_error_kind: null,
    })
    .eq("id", cell.id)
    .eq("status", "searching"); // race-safe — only writes if we still own it

  return { cellId: cell.id, outcome: "done", placesFound, placesNew, durationMs };
}

async function finalizeNoResults(
  adminSupabase: ReturnType<typeof createAdminClient>,
  cell: ClaimedCell,
  durationMs: number
): Promise<CellResult> {
  await adminSupabase
    .from("search_cells")
    .update({
      status: "no_results",
      places_found: 0,
      places_new: 0,
      duration_ms: durationMs,
      error_message: null,
      last_error_kind: null,
    })
    .eq("id", cell.id)
    .eq("status", "searching");

  return { cellId: cell.id, outcome: "no_results", placesFound: 0, placesNew: 0, durationMs };
}

async function finalizeError(
  adminSupabase: ReturnType<typeof createAdminClient>,
  cell: ClaimedCell,
  errorMessage: string,
  errorKind: string,
  durationMs: number
): Promise<CellResult> {
  await adminSupabase
    .from("search_cells")
    .update({
      status: "error",
      duration_ms: durationMs,
      error_message: errorMessage.slice(0, 1000),
      last_error_kind: errorKind,
    })
    .eq("id", cell.id)
    .eq("status", "searching");

  await recordHealth(adminSupabase, {
    source: "cell_runner",
    kind: "error",
    message: `Cell ${cell.area_label}/${cell.category} failed (attempt ${cell.attempts}): ${errorMessage}`,
    context: {
      cell_id: cell.id,
      campaign_id: cell.campaign_id,
      attempts: cell.attempts,
      error_kind: errorKind,
    },
  });

  // Hard alert if attempts crossed the threshold for the FIRST time
  if (cell.attempts === MAX_ATTEMPTS_BEFORE_ALERT) {
    await sendAlertIfFresh(
      adminSupabase,
      `cell_repeat_failure_${errorKind}`,
      `Discovery-Tick: ${errorKind}-Fehler bei mehreren Cells`,
      `Eine oder mehrere Such-Cells sind nach ${MAX_ATTEMPTS_BEFORE_ALERT} Versuchen mit dem gleichen Fehler-Typ (${errorKind}) fehlgeschlagen.\n\n` +
        `Letzter Cell: ${cell.area_label} / ${cell.category}\nFehler: ${errorMessage}\n\n` +
        `Mögliche Ursachen:\n` +
        `  • auth: API-Key abgelaufen oder ungültig\n` +
        `  • rate_limit: API-Quota für heute aufgebraucht\n` +
        `  • timeout: Google Places ist langsam\n` +
        `  • network: Server hat keine Internet-Verbindung`,
      {
        cell_id: cell.id,
        campaign_id: cell.campaign_id,
        category: cell.category,
        area: cell.area_label,
        error_kind: errorKind,
        attempts: cell.attempts,
      }
    );
  }

  return {
    cellId: cell.id,
    outcome: "error",
    placesFound: 0,
    placesNew: 0,
    durationMs,
    errorMessage,
    errorKind,
  };
}
