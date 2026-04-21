import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/providers/email/mailgun";
import { generateOutreachEmail } from "@/lib/providers/email/templates";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// POST /api/admin/outreach/[id]/send — Heutige Jobs senden
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

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
    });

    const result = await sendEmail({
      to: job.contact_email,
      subject,
      text,
      html,
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
  await supabase.rpc("increment_batch_sent", { batch_id: id, increment: sent }).catch(() => {
    // Fallback: manuell updaten
    supabase.from("outreach_batches")
      .select("sent_count")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        supabase.from("outreach_batches")
          .update({ sent_count: (data?.sent_count ?? 0) + sent, updated_at: new Date().toISOString() })
          .eq("id", id);
      });
  });

  return NextResponse.json({ sent, failed, errors, total: jobs.length });
}
