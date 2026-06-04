/**
 * POST /api/admin/leads/[id]/reactivate-from-solar
 *
 * Setzt einen fälschlicherweise als existing_solar markierten Lead zurück
 * auf status='new'. Existing_solar-Tracking-Spalten werden gelöscht.
 *
 * Outreach-Jobs werden NICHT automatisch wieder geöffnet — die wurden
 * storniert mit gutem Grund und können bei Bedarf manuell wieder angelegt
 * werden (Massenversand / LinkedIn-Pool).
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const { id } = await params;
  const sb = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await sb
    .from("solar_lead_mass")
    .update({
      status: "new",
      existing_solar_at: null,
      existing_solar_source: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "existing_solar"); // nur wenn aktuell wirklich existing_solar

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
