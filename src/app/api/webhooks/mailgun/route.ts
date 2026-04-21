import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyMailgunWebhook, sendEmail } from "@/lib/providers/email/mailgun";

// POST /api/webhooks/mailgun — Mailgun Inbound (Antworten erfassen)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // Felder aus Mailgun-Payload
    const recipient = formData.get("recipient") as string ?? "";
    const sender = formData.get("sender") as string ?? "";
    const from = formData.get("from") as string ?? "";
    const subject = formData.get("subject") as string ?? "";
    const bodyPlain = formData.get("body-plain") as string ?? "";
    const timestamp = formData.get("timestamp") as string ?? "";
    const token = formData.get("token") as string ?? "";
    const signature = formData.get("signature") as string ?? "";

    // Signatur verifizieren
    if (!verifyMailgunWebhook(timestamp, token, signature)) {
      console.error("[Mailgun Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Job-ID aus Reply-To-Adresse extrahieren
    // Format: reply+{job-id}@greenscout-ev.de
    const jobIdMatch = recipient.match(/reply\+([a-f0-9-]+)@/i);
    if (!jobIdMatch) {
      console.log("[Mailgun Webhook] No job-id in recipient:", recipient);
      return NextResponse.json({ ok: true, message: "No job-id found" });
    }

    const jobId = jobIdMatch[1];
    const supabase = await createClient();

    // Job laden
    const { data: job, error: jobError } = await supabase
      .from("outreach_jobs")
      .select("*, outreach_batches(name)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error("[Mailgun Webhook] Job not found:", jobId);
      return NextResponse.json({ ok: true, message: "Job not found" });
    }

    // Bereits bearbeitet?
    if (job.status === "replied") {
      return NextResponse.json({ ok: true, message: "Already replied" });
    }

    // Job aktualisieren
    await supabase
      .from("outreach_jobs")
      .update({
        status: "replied",
        replied_at: new Date().toISOString(),
        reply_content: bodyPlain.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Batch replied_count erhöhen
    const { data: batch } = await supabase
      .from("outreach_batches")
      .select("replied_count")
      .eq("id", job.batch_id)
      .single();

    if (batch) {
      await supabase
        .from("outreach_batches")
        .update({ replied_count: (batch.replied_count ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", job.batch_id);
    }

    // Closing-Team benachrichtigen
    const closingEmail = process.env.CLOSING_TEAM_EMAIL ?? "consulting@lumina-intelligence.ai";
    const batchName = (job.outreach_batches as { name: string } | null)?.name ?? "Unbekannter Batch";

    await sendEmail({
      to: closingEmail,
      subject: `🎯 Neue Antwort: ${job.company_name} – ${job.company_city}`,
      text: `Neues Lead hat geantwortet!

Unternehmen: ${job.company_name}
Stadt: ${job.company_city}
Kontakt: ${job.contact_name ?? "Unbekannt"} (${job.contact_title ?? ""})
E-Mail: ${sender}
Batch: ${batchName}

Antwort:
---
${bodyPlain.slice(0, 1000)}
---

Jetzt anrufen und closen!
👉 https://solarleadgen.lumina-intelligence.ai/admin/outreach/replies`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #16a34a; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">🎯 Neue Antwort eingegangen!</h2>
  </div>
  <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td style="padding: 8px; font-weight: bold; color: #6b7280; width: 140px;">Unternehmen</td><td style="padding: 8px; font-weight: bold; font-size: 18px;">${job.company_name}</td></tr>
      <tr><td style="padding: 8px; font-weight: bold; color: #6b7280;">Stadt</td><td style="padding: 8px;">${job.company_city}</td></tr>
      <tr><td style="padding: 8px; font-weight: bold; color: #6b7280;">Ansprechpartner</td><td style="padding: 8px;">${job.contact_name ?? "—"}<br><small style="color: #9ca3af;">${job.contact_title ?? ""}</small></td></tr>
      <tr><td style="padding: 8px; font-weight: bold; color: #6b7280;">E-Mail</td><td style="padding: 8px;"><a href="mailto:${sender}">${sender}</a></td></tr>
      <tr><td style="padding: 8px; font-weight: bold; color: #6b7280;">Batch</td><td style="padding: 8px;">${batchName}</td></tr>
    </table>
    <div style="background: white; border: 1px solid #d1d5db; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
      <p style="font-weight: bold; color: #374151; margin: 0 0 8px;">Antwort:</p>
      <p style="color: #4b5563; white-space: pre-wrap; margin: 0;">${bodyPlain.slice(0, 800).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    </div>
    <a href="https://solarleadgen.lumina-intelligence.ai/admin/outreach/replies"
       style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
      → Jetzt in SolarLead ansehen & anrufen
    </a>
  </div>
</div>`,
    });

    console.log(`[Mailgun Webhook] Reply from ${job.company_name} processed, closing team notified`);
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[Mailgun Webhook] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
