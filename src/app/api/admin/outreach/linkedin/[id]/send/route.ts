import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignJob } from "@/lib/team/auto-assign";

/**
 * POST /api/admin/outreach/linkedin/[id]/send
 * Markiert einen LinkedIn-Job als "gesendet". Wird vom UI getriggert
 * nachdem der Admin die InMail manuell in LinkedIn verschickt hat.
 *
 * Body: { message: string, template_id?: string, credits_used?: number }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const message = (body.message as string) ?? "";
  const templateId = (body.template_id as string | undefined) ?? null;
  const creditsUsed = (body.credits_used as number | undefined) ?? 1;

  if (!message.trim()) {
    return NextResponse.json({ error: "Nachricht ist leer" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json(
      { error: "LinkedIn-InMail-Limit ist 2000 Zeichen" },
      { status: 400 }
    );
  }

  const sb = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await sb
    .from("outreach_jobs")
    .update({
      status: "sent",
      sent_at: now,
      linkedin_sent_at: now,
      linkedin_message: message,
      linkedin_template_id: templateId,
      linkedin_inmail_credits: creditsUsed,
      updated_at: now,
    })
    .eq("id", id)
    .eq("channel", "linkedin");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, sent_at: now });
}
