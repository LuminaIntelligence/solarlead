import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// POST /api/admin/discovery/[id]/leads — bulk approve or reject
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id: campaignId } = await params;
  const body = await req.json();
  const { action, lead_ids, rejection_reason }: {
    action: "approve" | "reject";
    lead_ids: string[];
    rejection_reason?: string;
  } = body;

  if (!action || !lead_ids?.length) {
    return NextResponse.json({ error: "action und lead_ids sind erforderlich" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  if (action === "approve") {
    // Fetch full discovery lead data before approving (for solar backfill)
    const { data: dlsToApprove } = await adminSupabase
      .from("discovery_leads")
      .select("id, lead_id, solar_quality, max_array_area_m2, roof_area_m2, latitude, longitude")
      .in("id", lead_ids)
      .eq("campaign_id", campaignId);

    // Set discovery_leads to approved
    await adminSupabase
      .from("discovery_leads")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: user!.id,
        updated_at: new Date().toISOString(),
      })
      .in("id", lead_ids)
      .eq("campaign_id", campaignId);

    // Backfill solar_assessments from discovery data for any lead missing one
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
          // Other fields unknown at this stage — leave null
        });
      }
    }

    // Update campaign total_approved counter
    const { data: camp } = await adminSupabase
      .from("discovery_campaigns")
      .select("total_approved")
      .eq("id", campaignId)
      .single();

    await adminSupabase
      .from("discovery_campaigns")
      .update({
        total_approved: (camp?.total_approved ?? 0) + lead_ids.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return NextResponse.json({ ok: true, action: "approved", count: lead_ids.length });
  }

  if (action === "reject") {
    // Load discovery leads to get their lead_ids for cleanup
    const { data: dls } = await adminSupabase
      .from("discovery_leads")
      .select("id, lead_id")
      .in("id", lead_ids)
      .eq("campaign_id", campaignId);

    // Set discovery_leads to rejected
    await adminSupabase
      .from("discovery_leads")
      .update({
        status: "rejected",
        rejection_reason: rejection_reason ?? "Manuell abgelehnt",
        updated_at: new Date().toISOString(),
      })
      .in("id", lead_ids)
      .eq("campaign_id", campaignId);

    // Delete the provisional solar_lead_mass rows
    const provisionalLeadIds = (dls ?? [])
      .map((dl: { lead_id: string | null }) => dl.lead_id)
      .filter((id: string | null): id is string => !!id);

    if (provisionalLeadIds.length > 0) {
      await adminSupabase
        .from("solar_lead_mass")
        .delete()
        .in("id", provisionalLeadIds)
        .eq("is_pool_lead", true);
    }

    return NextResponse.json({ ok: true, action: "rejected", count: lead_ids.length });
  }

  return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
}
