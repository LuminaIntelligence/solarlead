import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";

interface BulkFilters {
  status?: string;
  min_contacts?: number;
  min_score?: number;
  min_area_m2?: number;
  solar_complete?: boolean;
}

/**
 * Resolves filter object into an array of discovery_lead IDs that match.
 * Used by the filter-based bulk action — the user picks "alle 1245 bereiten
 * Leads mit ≥2 Kontakten genehmigen" instead of selecting them one page at
 * a time.
 *
 * Hard cap of 5000 IDs returned. If the filter matches more, the API errors
 * out and asks the user to narrow the filter — guards against accidental
 * "approve everything that ever existed" typos.
 */
async function resolveFilterIds(
  adminSupabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  filters: BulkFilters
): Promise<{ ids: string[]; truncated: boolean; total: number }> {
  let q = adminSupabase
    .from("discovery_leads")
    .select("id, lead_id, contact_count, total_score, max_array_area_m2", { count: "exact" })
    .eq("campaign_id", campaignId);

  if (filters.status) q = q.eq("status", filters.status);
  if (typeof filters.min_contacts === "number") q = q.gte("contact_count", filters.min_contacts);
  if (typeof filters.min_score === "number") q = q.gte("total_score", filters.min_score);
  if (typeof filters.min_area_m2 === "number") q = q.gte("max_array_area_m2", filters.min_area_m2);

  // solar_complete: only leads whose linked lead has a complete solar_assessment
  if (filters.solar_complete) {
    const { data: completeAssessments } = await adminSupabase
      .from("solar_assessments")
      .select("lead_id")
      .not("max_array_panels_count", "is", null);
    const completeIds = (completeAssessments ?? []).map((a) => a.lead_id);
    if (completeIds.length === 0) {
      return { ids: [], truncated: false, total: 0 };
    }
    q = q.in("lead_id", completeIds.slice(0, 5000)); // cap to keep URL short
  }

  q = q.limit(5000);
  const { data, count, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.id as string);
  return {
    ids,
    truncated: (count ?? 0) > ids.length,
    total: count ?? ids.length,
  };
}

// POST /api/admin/discovery/[id]/leads — bulk approve or reject
//
// Two modes:
//   1. {action, lead_ids: string[]}  — explicit IDs (per-page selection)
//   2. {action, filters: {...}}      — server resolves matching IDs from filters
//
// The second mode lets the UI say "approve all 1245 leads matching X" without
// shipping 1245 UUIDs over the wire.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user } = gate;

  const { id: campaignId } = await params;
  const body = await req.json();
  const { action, lead_ids: rawIds, filters, rejection_reason }: {
    action: "approve" | "reject";
    lead_ids?: string[];
    filters?: BulkFilters;
    rejection_reason?: string;
  } = body;

  if (!action || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // Resolve filter mode to lead_ids
  let lead_ids = rawIds;
  if (!lead_ids?.length && filters) {
    const resolved = await resolveFilterIds(adminSupabase, campaignId, filters);
    if (resolved.truncated) {
      return NextResponse.json({
        error: `Filter trifft auf ${resolved.total} Leads zu — max 5000 pro Aktion. Bitte engere Filter setzen.`,
      }, { status: 400 });
    }
    lead_ids = resolved.ids;
  }

  if (!lead_ids?.length) {
    return NextResponse.json({ error: "Keine passenden Leads — wenn Filter gesetzt: trifft auf 0 zu" }, { status: 400 });
  }

  // Chunk to keep URLs under PostgREST's 8K limit. UUID = 36 chars + comma.
  // 200 IDs ≈ 7400 chars, safe margin.
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < lead_ids.length; i += CHUNK) {
    chunks.push(lead_ids.slice(i, i + CHUNK));
  }

  if (action === "approve") {
    let approved = 0;
    let assessmentsAdded = 0;
    for (const chunkIds of chunks) {
      // Fetch full discovery lead data before approving (for solar backfill)
      const { data: dlsToApprove } = await adminSupabase
        .from("discovery_leads")
        .select("id, lead_id, solar_quality, max_array_area_m2, roof_area_m2, latitude, longitude")
        .in("id", chunkIds)
        .eq("campaign_id", campaignId);

      // Set discovery_leads to approved
      const { data: updated } = await adminSupabase
        .from("discovery_leads")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: user!.id,
          updated_at: new Date().toISOString(),
        })
        .in("id", chunkIds)
        .eq("campaign_id", campaignId)
        .select("id");
      approved += updated?.length ?? 0;

      // Backfill solar_assessments from discovery data for any lead missing one.
      // Best-effort; per-row check is OK at chunk size 200.
      for (const dl of dlsToApprove ?? []) {
        if (!dl.lead_id || !dl.max_array_area_m2) continue;
        const { data: existing } = await adminSupabase
          .from("solar_assessments")
          .select("id")
          .eq("lead_id", dl.lead_id)
          .limit(1)
          .maybeSingle();
        if (!existing) {
          await adminSupabase.from("solar_assessments").insert({
            lead_id: dl.lead_id,
            provider: "google_solar",
            latitude: dl.latitude,
            longitude: dl.longitude,
            solar_quality: dl.solar_quality,
            max_array_area_m2: dl.max_array_area_m2,
          });
          assessmentsAdded++;
        }
      }
    }

    // Update campaign total_approved counter (single update for all chunks)
    const { data: camp } = await adminSupabase
      .from("discovery_campaigns")
      .select("total_approved")
      .eq("id", campaignId)
      .single();

    await adminSupabase
      .from("discovery_campaigns")
      .update({
        total_approved: (camp?.total_approved ?? 0) + approved,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return NextResponse.json({ ok: true, action: "approved", count: approved, assessments_added: assessmentsAdded });
  }

  // action === "reject"
  let rejected = 0;
  let provisionalDeleted = 0;
  for (const chunkIds of chunks) {
    const { data: dls } = await adminSupabase
      .from("discovery_leads")
      .select("id, lead_id")
      .in("id", chunkIds)
      .eq("campaign_id", campaignId);

    const { data: updated } = await adminSupabase
      .from("discovery_leads")
      .update({
        status: "rejected",
        rejection_reason: rejection_reason ?? "Manuell abgelehnt",
        updated_at: new Date().toISOString(),
      })
      .in("id", chunkIds)
      .eq("campaign_id", campaignId)
      .select("id");
    rejected += updated?.length ?? 0;

    const provisionalLeadIds = (dls ?? [])
      .map((dl) => dl.lead_id as string | null)
      .filter((id): id is string => !!id);
    if (provisionalLeadIds.length > 0) {
      const { data: del } = await adminSupabase
        .from("solar_lead_mass")
        .delete()
        .in("id", provisionalLeadIds)
        .eq("is_pool_lead", true)
        .select("id");
      provisionalDeleted += del?.length ?? 0;
    }
  }

  return NextResponse.json({ ok: true, action: "rejected", count: rejected, provisional_deleted: provisionalDeleted });
}
