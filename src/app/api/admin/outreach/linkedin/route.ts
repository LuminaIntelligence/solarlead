import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

/**
 * GET /api/admin/outreach/linkedin
 * Liste aller LinkedIn-Jobs (channel='linkedin'), gruppierbar nach Batch/Status.
 *
 * Query-Params:
 *   ?status=pending|sent|replied (default: alle)
 *   ?batch_id=<uuid>            (default: alle)
 */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const batchFilter = url.searchParams.get("batch_id");

  let q = supabase
    .from("outreach_jobs")
    .select(
      "id, batch_id, lead_id, status, contact_name, contact_title, company_name, company_city, company_category, linkedin_url, linkedin_sent_at, linkedin_message, replied_at, reply_content, outcome, scheduled_for, created_at, outreach_batches(name)"
    )
    .eq("channel", "linkedin")
    .order("created_at", { ascending: false });

  if (statusFilter) q = q.eq("status", statusFilter);
  if (batchFilter) q = q.eq("batch_id", batchFilter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Counts pro Status (für die Dashboard-Tabs)
  const { data: allStatus } = await supabase
    .from("outreach_jobs")
    .select("status")
    .eq("channel", "linkedin");
  const counts: Record<string, number> = {};
  for (const j of allStatus ?? []) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
  }

  // Heutige InMail-Verbräuche (für Rate-Limit-Warnung)
  const today = new Date().toISOString().slice(0, 10);
  const { data: todaySent } = await supabase
    .from("outreach_jobs")
    .select("id")
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .gte("linkedin_sent_at", `${today}T00:00:00Z`);

  return NextResponse.json({
    jobs: data ?? [],
    counts,
    today_sent_count: todaySent?.length ?? 0,
  });
}
