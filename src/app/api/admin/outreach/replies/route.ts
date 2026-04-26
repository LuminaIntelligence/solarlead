import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * GET /api/admin/outreach/replies
 * Returns all outreach jobs with status = 'replied', enriched with batch name and pipeline_stage.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
