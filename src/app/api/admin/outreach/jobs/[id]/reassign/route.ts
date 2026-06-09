/**
 * POST /api/admin/outreach/jobs/[id]/reassign
 *
 * Setzt assigned_to eines Outreach-Jobs neu. Wird vom Admin verwendet
 * um Leads zwischen Reply-Specialists zu verschieben (Überlastung,
 * Urlaub, themat. Zuordnung).
 *
 * Body: { user_id: string | null }   — null = zurück in den Pool
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
  const body = await req.json().catch(() => ({}));
  const newUserId = (body.user_id as string | null) ?? null;

  const sb = createAdminClient();
  const now = new Date().toISOString();

  // Wenn newUserId !== null: prüfen dass es ein gültiger User mit Rolle ist
  if (newUserId) {
    const { data: target } = await sb
      .from("user_settings")
      .select("user_id, role")
      .eq("user_id", newUserId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "Ziel-User nicht gefunden" }, { status: 400 });
    }
    if (!["reply_specialist", "team_lead", "admin"].includes(target.role)) {
      return NextResponse.json(
        { error: `Ziel-User hat falsche Rolle: ${target.role}` },
        { status: 400 }
      );
    }
  }

  const { error } = await sb
    .from("outreach_jobs")
    .update({
      assigned_to: newUserId,
      updated_at: now,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Activity-Eintrag schreiben
  await sb.from("outreach_activities").insert({
    job_id: id,
    user_id: gate.user!.id,
    kind: "note",
    content: newUserId
      ? `Re-assigned an User ${newUserId.slice(0, 8)}`
      : "Zurück in den Pool",
  });

  return NextResponse.json({ ok: true });
}
