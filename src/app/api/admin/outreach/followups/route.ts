import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * GET /api/admin/outreach/followups
 * Returns all pending follow-up jobs across all batches, enriched with batch info.
 * Grouped into: due today/overdue, upcoming (next 14 days).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  // All follow-up enabled batches
  const { data: batches } = await supabase
    .from("outreach_batches")
    .select("id, name, followup_template, followup_days")
    .eq("followup_enabled", true);

  if (!batches || batches.length === 0) {
    return NextResponse.json({ due: [], upcoming: [], stats: { due: 0, upcoming: 0, sent_total: 0 } });
  }

  const batchIds = batches.map((b) => b.id);
  const batchMap = Object.fromEntries(batches.map((b) => [b.id, b]));

  // Due today or overdue (followup_scheduled_for <= today, status pending)
  const { data: dueJobs } = await supabase
    .from("outreach_jobs")
    .select("id, batch_id, company_name, company_city, company_category, contact_name, contact_email, contact_title, followup_scheduled_for, followup_status, status, roof_area_m2")
    .in("batch_id", batchIds)
    .eq("followup_status", "pending")
    .lte("followup_scheduled_for", today)
    .not("status", "eq", "pending")
    .not("status", "eq", "replied")
    .not("status", "eq", "bounced")
    .not("status", "eq", "opted_out")
    .order("followup_scheduled_for");

  // Upcoming (next 14 days, not yet due)
  const { data: upcomingJobs } = await supabase
    .from("outreach_jobs")
    .select("id, batch_id, company_name, company_city, company_category, contact_name, contact_email, contact_title, followup_scheduled_for, followup_status, status, roof_area_m2")
    .in("batch_id", batchIds)
    .eq("followup_status", "pending")
    .gt("followup_scheduled_for", today)
    .lte("followup_scheduled_for", in14Days)
    .not("status", "eq", "replied")
    .not("status", "eq", "bounced")
    .not("status", "eq", "opted_out")
    .order("followup_scheduled_for");

  // Total sent follow-ups
  const { count: sentTotal } = await supabase
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .in("batch_id", batchIds)
    .eq("followup_status", "sent");

  // Enrich with batch info
  const enriched = (jobs: typeof dueJobs) =>
    (jobs ?? []).map((j) => ({
      ...j,
      batch_name: batchMap[j.batch_id]?.name ?? "Unbekannt",
      followup_template: batchMap[j.batch_id]?.followup_template ?? "followup",
    }));

  return NextResponse.json({
    due: enriched(dueJobs),
    upcoming: enriched(upcomingJobs),
    stats: {
      due: dueJobs?.length ?? 0,
      upcoming: upcomingJobs?.length ?? 0,
      sent_total: sentTotal ?? 0,
    },
  });
}
