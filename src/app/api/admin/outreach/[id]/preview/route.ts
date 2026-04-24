import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachEmail } from "@/lib/providers/email/templates";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * GET /api/admin/outreach/[id]/preview?job_id=xxx
 * Generates the email preview for a specific outreach job without sending it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const jobId = req.nextUrl.searchParams.get("job_id");

  // Load batch for template_type
  const { data: batch } = await supabase
    .from("outreach_batches")
    .select("template_type, name")
    .eq("id", id)
    .single();

  if (!batch) return NextResponse.json({ error: "Batch nicht gefunden" }, { status: 404 });

  // If job_id provided → generate for that specific job
  if (jobId) {
    const { data: job } = await supabase
      .from("outreach_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("batch_id", id)
      .single();

    if (!job) return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });

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

    return NextResponse.json({
      subject,
      html,
      text,
      to: job.contact_email,
      contact_name: job.contact_name,
      company_name: job.company_name,
      template_type: templateType,
    });
  }

  // No job_id → return first pending job as example
  const { data: exampleJob } = await supabase
    .from("outreach_jobs")
    .select("*")
    .eq("batch_id", id)
    .eq("status", "pending")
    .limit(1)
    .single();

  if (!exampleJob) return NextResponse.json({ error: "Kein ausstehender Job gefunden" }, { status: 404 });

  const templateType = (batch.template_type ?? "erstkontakt") as "erstkontakt" | "followup" | "finale";
  const { subject, text, html } = generateOutreachEmail({
    contactName: exampleJob.contact_name,
    contactTitle: exampleJob.contact_title,
    companyName: exampleJob.company_name ?? "Unternehmen",
    city: exampleJob.company_city ?? "",
    category: exampleJob.company_category ?? "",
    roofAreaM2: exampleJob.roof_area_m2 ?? null,
    templateType,
  });

  return NextResponse.json({
    subject,
    html,
    text,
    to: exampleJob.contact_email,
    contact_name: exampleJob.contact_name,
    company_name: exampleJob.company_name,
    template_type: templateType,
  });
}
