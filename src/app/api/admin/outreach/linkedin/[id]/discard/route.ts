/**
 * POST /api/admin/outreach/linkedin/[id]/discard
 *
 * Verwirft einen offenen LinkedIn-Job (status='pending'). Job bleibt in der
 * Datenbank, wird nur als 'cancelled' markiert — taucht nicht mehr in der
 * "Offen"-Liste auf. Idempotent.
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
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      followup_status: "skipped",
      updated_at: now,
    })
    .eq("id", id)
    .eq("channel", "linkedin")
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
