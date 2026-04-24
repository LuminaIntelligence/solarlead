import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachEmail } from "@/lib/providers/email/templates";
import { sendEmail } from "@/lib/providers/email/mailgun";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * POST /api/admin/outreach/[id]/test-send
 * Sends a test email for a specific job to a given address.
 * Adds a [TEST] banner so it's clearly marked.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { to, job_id } = body as { to?: string; job_id?: string };

  if (!to) return NextResponse.json({ error: "Empfänger-E-Mail fehlt" }, { status: 400 });

  // Load batch
  const { data: batch } = await supabase
    .from("outreach_batches")
    .select("template_type, name")
    .eq("id", id)
    .single();

  if (!batch) return NextResponse.json({ error: "Batch nicht gefunden" }, { status: 404 });

  // Load job (or use first pending job as example)
  let job;
  if (job_id) {
    const { data } = await supabase.from("outreach_jobs").select("*").eq("id", job_id).single();
    job = data;
  } else {
    const { data } = await supabase
      .from("outreach_jobs")
      .select("*")
      .eq("batch_id", id)
      .limit(1)
      .single();
    job = data;
  }

  if (!job) return NextResponse.json({ error: "Kein Job gefunden" }, { status: 404 });

  const templateType = (batch.template_type ?? "erstkontakt") as "erstkontakt" | "followup" | "finale";
  const { subject, text, html } = generateOutreachEmail({
    contactName: job.contact_name,
    contactTitle: job.contact_title,
    companyName: job.company_name ?? "Unternehmen",
    city: job.company_city ?? "",
    category: job.company_category ?? "",
    roofAreaM2: job.roof_area_m2 ?? null,
    templateType,
  });

  // Add TEST banner to HTML
  const testHtml = html.replace(
    "<body",
    `<body><div style="background:#fef3c7;border:2px dashed #f59e0b;padding:12px 16px;text-align:center;font-family:sans-serif;font-size:13px;font-weight:bold;color:#92400e;">⚠️ TEST-E-MAIL — Batch: ${batch.name} · Lead: ${job.company_name}</div>`
  );

  const ok = await sendEmail({
    to,
    subject: `[TEST] ${subject}`,
    text: `--- TEST E-MAIL ---\nBatch: ${batch.name}\nLead: ${job.company_name}\n\n${text}`,
    html: testHtml,
  });

  if (!ok) return NextResponse.json({ error: "E-Mail-Versand fehlgeschlagen" }, { status: 500 });

  return NextResponse.json({
    message: `Test-E-Mail gesendet an ${to}`,
  });
}
