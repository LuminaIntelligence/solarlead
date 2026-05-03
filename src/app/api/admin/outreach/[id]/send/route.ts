import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, type SenderProfile } from "@/lib/providers/email/mailgun";
import { generateOutreachEmail } from "@/lib/providers/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";

import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// POST /api/admin/outreach/[id]/send — Heutige Jobs senden
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

  // Absender-Profil des eingeloggten Nutzers laden
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

  // Batch laden (für template_type)
  const { data: batch } = await supabase
    .from("outreach_batches")
    .select("template_type")
    .eq("id", id)
    .single();

  const templateType = (batch?.template_type ?? "erstkontakt") as "erstkontakt" | "followup" | "finale";

  // Heutige pending Jobs laden
  const { data: jobs, error: jobsError } = await supabase
    .from("outreach_jobs")
    .select("*")
    .eq("batch_id", id)
    .eq("status", "pending")
    .eq("scheduled_for", today);

  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 });
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ sent: 0, message: "Keine Jobs für heute ausstehend" });
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    if (!job.contact_email) {
      failed++;
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

    const result = await sendEmail({
      to: job.contact_email,
      subject,
      text,
      html,
      senderProfile,
      replyToJobId: job.id,
      "o:tag": ["outreach", `batch-${id}`],
      "v:job-id": job.id,
    });

    if (result) {
      await supabase
        .from("outreach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          personalized_subject: subject,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      sent++;
    } else {
      errors.push(`${job.company_name}: Mailgun-Fehler`);
      failed++;
    }

    // 200ms Pause zwischen E-Mails (Rate Limiting)
    await new Promise((r) => setTimeout(r, 200));
  }

  // Batch-Zähler aktualisieren
  const { data: batchData } = await supabase
    .from("outreach_batches")
    .select("sent_count")
    .eq("id", id)
    .single();

  await supabase
    .from("outreach_batches")
    .update({ sent_count: (batchData?.sent_count ?? 0) + sent, updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ sent, failed, errors, total: jobs.length });
}
