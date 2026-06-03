import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

/**
 * GET /api/admin/outreach/linkedin
 * Liste aller LinkedIn-Jobs (channel='linkedin'), gruppierbar nach Batch/Status.
 *
 * Query-Params:
 *   ?status=pending|sent|replied|expired   (default: alle)
 *   ?batch_id=<uuid>                       (default: alle)
 *   ?category=cold_storage,food_production (CSV, default: alle)
 *   ?city=<contains>                       (case-insensitive substring match)
 *   ?title=<contains>                      (case-insensitive substring match auf contact_title)
 *   ?min_score=<int>                       (joined via solar_lead_mass.total_score)
 *   ?max_score=<int>
 *   ?sort=score_desc|score_asc|company|city|newest   (default: score_desc)
 */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const batchFilter = url.searchParams.get("batch_id");
  const categoryFilter = url.searchParams.get("category");
  const cityFilter = url.searchParams.get("city");
  const titleFilter = url.searchParams.get("title");
  const minScore = url.searchParams.get("min_score");
  const maxScore = url.searchParams.get("max_score");
  const sortKey = url.searchParams.get("sort") ?? "newest";

  let q = supabase
    .from("outreach_jobs")
    .select(
      "id, batch_id, lead_id, status, contact_name, contact_title, company_name, company_city, company_category, linkedin_url, linkedin_sent_at, linkedin_message, replied_at, reply_content, outcome, outcome_at, scheduled_for, created_at, outreach_batches(name), solar_lead_mass(total_score)"
    )
    .eq("channel", "linkedin");

  if (statusFilter === "expired") {
    q = q.eq("status", "sent").eq("outcome", "no_reply");
  } else if (statusFilter === "sent") {
    q = q.eq("status", "sent").is("outcome", null);
  } else if (statusFilter) {
    q = q.eq("status", statusFilter);
  }
  if (batchFilter) q = q.eq("batch_id", batchFilter);

  // Category Multi-Select via CSV
  if (categoryFilter) {
    const cats = categoryFilter.split(",").map((c) => c.trim()).filter(Boolean);
    if (cats.length > 0) q = q.in("company_category", cats);
  }
  if (cityFilter) q = q.ilike("company_city", `%${cityFilter}%`);
  if (titleFilter) q = q.ilike("contact_title", `%${titleFilter}%`);

  // Score-Filter erfordert Inner-Join — Supabase macht das via !inner Hinweis
  // im embedded resource. Pragmatisch: wir filtern clientseitig nach Fetch,
  // da total_score embedded ist. Kein extra DB-Roundtrip.

  // Sortierung in der DB
  if (sortKey === "company") q = q.order("company_name", { ascending: true });
  else if (sortKey === "city") q = q.order("company_city", { ascending: true });
  else q = q.order("created_at", { ascending: false });
  q = q.limit(1000); // Hard-Cap zum Schutz

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Score-Filter + Sort nach Score: clientseitig auf embedded total_score
  type JobRow = (typeof data extends Array<infer T> ? T : never) & {
    solar_lead_mass?: { total_score?: number | null } | null;
  };
  const rows = (data ?? []) as unknown as JobRow[];
  const min = minScore ? Number(minScore) : null;
  const max = maxScore ? Number(maxScore) : null;
  let filtered = rows.filter((r) => {
    const s = r.solar_lead_mass?.total_score ?? null;
    if (min !== null && (s === null || s < min)) return false;
    if (max !== null && (s === null || s > max)) return false;
    return true;
  });
  if (sortKey === "score_desc") {
    filtered = filtered.sort(
      (a, b) =>
        (b.solar_lead_mass?.total_score ?? 0) - (a.solar_lead_mass?.total_score ?? 0)
    );
  } else if (sortKey === "score_asc") {
    filtered = filtered.sort(
      (a, b) =>
        (a.solar_lead_mass?.total_score ?? 0) - (b.solar_lead_mass?.total_score ?? 0)
    );
  }

  // Counts pro Status (für die Dashboard-Tabs)
  const { data: allStatus } = await supabase
    .from("outreach_jobs")
    .select("status, outcome")
    .eq("channel", "linkedin");
  const counts: Record<string, number> = {};
  for (const j of allStatus ?? []) {
    if (j.status === "sent" && j.outcome === "no_reply") {
      counts.expired = (counts.expired ?? 0) + 1;
    } else if (j.status === "sent") {
      counts.sent = (counts.sent ?? 0) + 1;
    } else {
      counts[j.status] = (counts[j.status] ?? 0) + 1;
    }
  }

  // Heutige InMail-Verbräuche (für Rate-Limit-Warnung)
  const today = new Date().toISOString().slice(0, 10);
  const { data: todaySent } = await supabase
    .from("outreach_jobs")
    .select("id")
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .gte("linkedin_sent_at", `${today}T00:00:00Z`);

  // Stale-Reminder: sent ohne outcome, älter als 24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: staleRows } = await supabase
    .from("outreach_jobs")
    .select("id")
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .is("outcome", null)
    .lt("linkedin_sent_at", dayAgo);

  return NextResponse.json({
    jobs: filtered,
    total_unfiltered: data?.length ?? 0,
    total_filtered: filtered.length,
    counts,
    today_sent_count: todaySent?.length ?? 0,
    stale_sent_count: staleRows?.length ?? 0,
  });
}
