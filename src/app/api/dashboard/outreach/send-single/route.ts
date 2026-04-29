import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOutreachEmail } from "@/lib/providers/email/templates";
import { sendEmail, type SenderProfile } from "@/lib/providers/email/mailgun";

/**
 * POST /api/dashboard/outreach/send-single
 * Sends a single outreach email directly from the lead detail page.
 * Any authenticated user can call this — no admin role required.
 * Uses the calling user's sender profile from user_settings.
 * Creates/reuses a per-user "Direktversand" batch for tracking.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const body = await req.json() as {
    lead_id: string;
    contact_email: string;
    contact_name: string | null;
    contact_title: string | null;
    company_name: string;
    city: string;
    category: string;
    roof_area_m2: number | null;
    template_type: "erstkontakt" | "followup" | "finale";
  };

  const {
    lead_id,
    contact_email,
    contact_name,
    contact_title,
    company_name,
    city,
    category,
    roof_area_m2,
    template_type,
  } = body;

  if (!contact_email) {
    return NextResponse.json({ error: "Keine E-Mail-Adresse angegeben" }, { status: 400 });
  }

  // Absender-Profil des eingeloggten Nutzers laden
  const adminClient = createAdminClient();
  let senderProfile: SenderProfile | null = null;
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

  // E-Mail generieren
  const { subject, text, html } = generateOutreachEmail({
    contactName: contact_name,
    contactTitle: contact_title,
    companyName: company_name,
    city,
    category,
    roofAreaM2: roof_area_m2,
    templateType: template_type,
    senderProfile,
  });

  // "Direktversand"-Batch für diesen User suchen oder anlegen
  let batchId: string;
  const { data: existingBatch } = await supabase
    .from("outreach_batches")
    .select("id, sent_count")
    .eq("created_by", user.id)
    .eq("name", "Direktversand")
    .maybeSingle();

  if (existingBatch) {
    batchId = existingBatch.id;
  } else {
    const { data: newBatch, error: batchError } = await supabase
      .from("outreach_batches")
      .insert({
        created_by: user.id,
        name: "Direktversand",
        description: "Einzelne E-Mails direkt aus der Lead-Detailseite",
        status: "active",
        template_type,
        daily_limit: 999,
        total_leads: 0,
        sent_count: 0,
        followup_enabled: false,
      })
      .select("id")
      .single();

    if (batchError || !newBatch) {
      return NextResponse.json({ error: "Batch konnte nicht angelegt werden" }, { status: 500 });
    }
    batchId = newBatch.id;
  }

  // Versand via Mailgun
  const ok = await sendEmail({
    to: contact_email,
    subject,
    text,
    html,
    senderProfile,
  });

  if (!ok) {
    return NextResponse.json({ error: "E-Mail-Versand fehlgeschlagen" }, { status: 500 });
  }

  // Job für Tracking anlegen
  await supabase.from("outreach_jobs").insert({
    batch_id: batchId,
    lead_id,
    status: "sent",
    contact_name,
    contact_email,
    contact_title,
    company_name,
    company_city: city,
    company_category: category,
    roof_area_m2,
    personalized_subject: subject,
    assigned_to: user.id,
    sent_at: new Date().toISOString(),
    scheduled_for: new Date().toISOString().slice(0, 10),
  });

  // Batch-Zähler hochzählen
  await supabase
    .from("outreach_batches")
    .update({
      sent_count: (existingBatch?.sent_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return NextResponse.json({ ok: true, message: `E-Mail gesendet an ${contact_email}` });
}
