import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

/**
 * GET /api/admin/outreach/replies
 * Returns all outreach jobs with status = 'replied', enriched with batch name and pipeline_stage.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("outreach_jobs")
    .select(
      "id, company_name, company_city, company_category, contact_name, contact_email, contact_title, reply_content, replied_at, pipeline_stage, status, outreach_batches(name)"
    )
    .eq("status", "replied")
    .order("replied_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ jobs: data ?? [] });
}
