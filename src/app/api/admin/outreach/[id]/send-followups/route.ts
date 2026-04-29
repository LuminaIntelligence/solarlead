import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOutreachEmail } from "@/lib/providers/email/templates";
import { sendEmail, type SenderProfile } from "@/lib/providers/email/mailgun";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * POST /api/admin/outreach/[id]/send-followups
 * Sends follow-up emails for all eligible jobs in a batch:
 * - followup_scheduled_for <= today
 * - followup_status = 'pending'
 * - job.status != 'replied' (they already replied → skip)
 * - job.status != 'pending' (initial email not yet sent → skip)
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

  // Absender-Profil laden
  const adminClient = createAdminClient();
  let senderProfile: SenderProfile | null = null;
  if (user) {
    const { data: settings } = await adminClient
      .from("user_settings")
      .select("email_sender_name, email_sender_title, email_sender_email, email_sender_phone")
      .eq("user_id", user.id)
      .single();
    if (settings?.email_sender_name && settings?.email_sender_email) {
      senderProfile = {
        name: settings.email_sender_name,
        title: settings.email_sender_title ?? "",
        email: settings.email_sender_email,
        phone: settings.email_sender_phone ?? "",
      };
    }
  }

  // Load batch
  const { data: batch } = await supabase
    .from("outreach_batches")
    .select("followup_enabled, followup_template, followup_sent_count, name")
    .eq("id", id)
    .single();

  if (!batch) return NextResponse.json({ error: "Batch nicht gefunden" }, { status: 404 });
  if (!batch.followup_enabled) {
    return NextResponse.json({ error: "Follow-up ist für diesen Batch nicht aktiviert" }, { status: 400 });
  }

  // Find eligible follow-up jobs
  const { data: jobs, error } = await supabase
    .from("outreach_jobs")
    .select("*")
    .eq("batch_id", id)
    .eq("followup_status", "pending")
    .lte("followup_scheduled_for", today)
    .not("status", "eq", "pending")       // initial must have been sent
    .not("status", "eq", "replied")       // no need if already replied
    .not("status", "eq", "bounced")       // don't retry bounced
    .not("status", "eq", "opted_out");    // respect opt-outs

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, message: "Keine fälligen Follow-ups gefunden" });
  }

  const templateType = (batch.followup_template ?? "followup") as "erstkontakt" | "followup" | "finale";

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    if (!job.contact_email) {
      // No email → mark as skipped
      await supabase
        .from("outreach_jobs")
        .update({ followup_status: "skipped", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      skipped++;
      continue;
    }

    const { subject, text, html } = generateOutreachEmail({
      contactName: job.contact_name,
      contactTitle: job.contact_title,
      companyName: job.company_name ?? "Ihr Unternehmen",
      city: job.company_city ?? "",
      category: job.company_category ?? "",
      roofAreaM2: job.roof_area_m2 ?? null,
      templateType,
      senderProfile,
    });

    const ok = await sendEmail({
      to: job.contact_email,
      subject,
      text,
      html,
      senderProfile,
      replyToJobId: job.id,
      "o:tag": ["outreach", "followup", `batch-${id}`],
      "v:job-id": job.id,
    });

    if (ok) {
      await supabase
        .from("outreach_jobs")
        .update({
          followup_status: "sent",
          followup_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      sent++;
    } else {
      failed++;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  // Update batch followup counter
  if (sent > 0) {
    await supabase
      .from("outreach_batches")
      .update({
        followup_sent_count: (batch.followup_sent_count ?? 0) + sent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  return NextResponse.json({
    sent,
    skipped,
    failed,
    total: jobs.length,
    message: `${sent} Follow-up${sent !== 1 ? "s" : ""} gesendet${skipped > 0 ? `, ${skipped} übersprungen` : ""}${failed > 0 ? `, ${failed} fehlgeschlagen` : ""}`,
  });
}
