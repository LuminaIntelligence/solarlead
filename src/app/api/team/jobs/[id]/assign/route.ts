/**
 * PATCH /api/team/jobs/[id]/assign
 *
 * Team-lead / admin reassignment. Body: { user_id: string | null }
 * Setting user_id=null returns the job to the pool.
 *
 * Specialists cannot reassign — they use /claim from the pool only.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMemberAndOrigin, canSeeAllReplies } from "@/lib/auth/admin-gate";
import { recordActivity } from "@/lib/team/activities";

const Schema = z.object({
  user_id: z.string().uuid().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMemberAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, role, adminSupabase } = gate;
  const { id } = await params;

  if (!canSeeAllReplies(role)) {
    return NextResponse.json({ error: "Nur Team-Lead/Admin kann zuweisen" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  }

  // Fetch existing for activity log
  const { data: oldJob } = await adminSupabase
    .from("outreach_jobs")
    .select("assigned_to")
    .eq("id", id)
    .maybeSingle();
  if (!oldJob) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // If a target user is provided, verify they're a valid team member
  if (parsed.data.user_id) {
    const { data: target } = await adminSupabase
      .from("user_settings")
      .select("role")
      .eq("user_id", parsed.data.user_id)
      .maybeSingle();
    if (!target || !["reply_specialist", "team_lead", "admin"].includes(target.role as string)) {
      return NextResponse.json({ error: "Ziel-User ist kein Team-Mitglied" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await adminSupabase
    .from("outreach_jobs")
    .update({
      assigned_to: parsed.data.user_id,
      assigned_at: parsed.data.user_id ? now : null,
      last_activity_at: now,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve emails for the activity log
  let oldEmail: string | null = null;
  let newEmail: string | null = null;
  if (oldJob.assigned_to) {
    const { data: u } = await adminSupabase.auth.admin.getUserById(oldJob.assigned_to as string);
    oldEmail = u?.user?.email ?? null;
  }
  if (parsed.data.user_id) {
    const { data: u } = await adminSupabase.auth.admin.getUserById(parsed.data.user_id);
    newEmail = u?.user?.email ?? null;
  }

  await recordActivity(adminSupabase, {
    job_id: id,
    user_id: user.id,
    kind: "reassigned",
    content: parsed.data.user_id
      ? `Zugewiesen an ${newEmail ?? parsed.data.user_id}${oldEmail ? ` (vorher ${oldEmail})` : ""}`
      : `In den Pool zurückgegeben${oldEmail ? ` (war: ${oldEmail})` : ""}`,
    context: {
      old_user_id: oldJob.assigned_to,
      new_user_id: parsed.data.user_id,
      reassigned_by: user.id,
    },
  });

  return NextResponse.json({ job: data });
}
