import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignJob } from "@/lib/team/auto-assign";

/**
 * POST /api/admin/outreach/linkedin/[id]/reply
 * Markiert einen LinkedIn-Job als beantwortet. Wird manuell ausgelöst
 * sobald der Admin sieht dass via LinkedIn eine Antwort kam.
 * Routes dann ins Reply-Team via Round-Robin (gleiche Logik wie Email).
 *
 * Body: { content?: string }   — optional: Reply-Inhalt zum Tracken
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const content = (body.content as string) ?? "";

  const sb = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await sb
    .from("outreach_jobs")
    .update({
      status: "replied",
      replied_at: now,
      reply_content: content.slice(0, 1000),
      outcome: "new",
      outcome_at: now,
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("channel", "linkedin");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-Assign an Reply-Specialist (Round-Robin, identisch zu Email-Path)
  let assignedTo: string | null = null;
  try {
    const result = await autoAssignJob(sb, id);
    assignedTo = result.assignedTo;
  } catch (e) {
    console.warn("[linkedin/reply] auto-assign failed for", id, e);
  }

  return NextResponse.json({ ok: true, assigned_to: assignedTo });
}
