/**
 * POST /api/team/jobs/[id]/claim
 *
 * Self-claim from the pool. Specialists call this when they pick up an
 * unassigned reply. Race-safe via .is("assigned_to", null) condition.
 *
 * Team-leads/admins use a different endpoint to assign on behalf of
 * someone else (PATCH /api/team/jobs/[id]/assign).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTeamMemberAndOrigin } from "@/lib/auth/admin-gate";
import { recordActivity } from "@/lib/team/activities";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMemberAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, adminSupabase } = gate;
  const { id } = await params;

  const now = new Date().toISOString();
  const { data, error } = await adminSupabase
    .from("outreach_jobs")
    .update({ assigned_to: user.id, assigned_at: now, last_activity_at: now })
    .eq("id", id)
    .is("assigned_to", null) // race-safe
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // Either doesn't exist OR was just claimed by someone else
    return NextResponse.json({ error: "Bereits zugewiesen oder nicht gefunden" }, { status: 409 });
  }

  await recordActivity(adminSupabase, {
    job_id: id,
    user_id: user.id,
    kind: "claimed",
    content: "Aus dem Pool übernommen",
  });

  return NextResponse.json({ job: data });
}
