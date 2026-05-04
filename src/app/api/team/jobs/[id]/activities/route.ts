/**
 * POST /api/team/jobs/[id]/activities
 *
 * Append a single activity to a job's audit log. Used by the quick-action
 * buttons on the reply detail page (call attempted / connected / email sent /
 * note).
 *
 * Same access rules as GET /api/team/jobs/[id].
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMemberAndOrigin, canSeeAllReplies } from "@/lib/auth/admin-gate";
import { recordActivity } from "@/lib/team/activities";

const Schema = z.object({
  kind: z.enum([
    "call_attempted", "call_connected", "email_sent", "note",
    "stage_changed", "outcome_changed", "reminder_set", "reassigned", "claimed",
  ]),
  content: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMemberAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, role, adminSupabase } = gate;
  const { id } = await params;

  // Confirm user can access this job
  const { data: job } = await adminSupabase
    .from("outreach_jobs")
    .select("id, assigned_to")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!canSeeAllReplies(role) && job.assigned_to !== user.id && job.assigned_to != null) {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });

  await recordActivity(adminSupabase, {
    job_id: id,
    user_id: user.id,
    kind: parsed.data.kind,
    content: parsed.data.content,
    context: parsed.data.context ?? null,
  });

  return NextResponse.json({ ok: true });
}
