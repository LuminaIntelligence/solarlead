/**
 * GET /api/team/inbox
 *
 * Returns the work queue for the calling user, organized into sections:
 *   - overdue:        next_action_at < now() AND not terminal
 *   - today:          next_action_at within today AND not terminal
 *   - mine:           assigned to me, no scheduled action, not terminal
 *   - pool:           unassigned replies (only when role can claim)
 *   - sla_violations: (lead/admin only) replies > 3h unassigned OR > 24h since last activity
 *   - recent_closed:  last 10 closed in the past 7 days (for context)
 *
 * Specialists see: overdue/today/mine for themselves + pool.
 * Team-leads/admins see all of the above + an `all_open` array with the
 * full active queue and per-specialist breakdowns.
 */
import { NextResponse } from "next/server";
import { requireTeamMember, canSeeAllReplies } from "@/lib/auth/admin-gate";
import { SLA } from "@/lib/constants/reply-outcomes";

const TERMINAL = ["closed_won", "closed_lost", "not_interested"];
const ACTIVE_OUTCOMES = ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"];

export async function GET() {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { user, role, adminSupabase } = gate;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const slaAssignThreshold = new Date(now.getTime() - SLA.ASSIGN_HOURS * 60 * 60 * 1000);
  const slaRespondThreshold = new Date(now.getTime() - SLA.RESPOND_HOURS * 60 * 60 * 1000);

  const seeAll = canSeeAllReplies(role);

  // Helper to build the "select fields" we return for each card
  const SELECT = "id, company_name, company_city, contact_name, contact_email, " +
    "outcome, next_action_at, next_action_note, replied_at, last_activity_at, " +
    "assigned_to, assigned_at, pipeline_stage, batch_id, lead_id, closed_value_eur";

  // 1. Overdue: next_action_at < now AND active
  const overdueQ = adminSupabase
    .from("outreach_jobs")
    .select(SELECT)
    .lt("next_action_at", now.toISOString())
    .in("outcome", ACTIVE_OUTCOMES)
    .order("next_action_at", { ascending: true })
    .limit(50);

  // 2. Today: next_action_at within today
  const todayQ = adminSupabase
    .from("outreach_jobs")
    .select(SELECT)
    .gte("next_action_at", startOfToday.toISOString())
    .lte("next_action_at", endOfToday.toISOString())
    .in("outcome", ACTIVE_OUTCOMES)
    .order("next_action_at", { ascending: true })
    .limit(50);

  // 3. Mine: assigned to me, no scheduled action, active
  const mineQ = adminSupabase
    .from("outreach_jobs")
    .select(SELECT)
    .eq("assigned_to", user.id)
    .is("next_action_at", null)
    .in("outcome", ACTIVE_OUTCOMES)
    .order("replied_at", { ascending: true })
    .limit(50);

  // 4. Pool: unassigned, replied
  const poolQ = adminSupabase
    .from("outreach_jobs")
    .select(SELECT)
    .is("assigned_to", null)
    .eq("status", "replied")
    .order("replied_at", { ascending: true })
    .limit(50);

  // 5. SLA violations (lead/admin only)
  const slaPoolQ = seeAll
    ? adminSupabase
        .from("outreach_jobs")
        .select(SELECT)
        .is("assigned_to", null)
        .eq("status", "replied")
        .lt("replied_at", slaAssignThreshold.toISOString())
        .limit(50)
    : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

  const slaResponseQ = seeAll
    ? adminSupabase
        .from("outreach_jobs")
        .select(SELECT)
        .not("assigned_to", "is", null)
        .lt("last_activity_at", slaRespondThreshold.toISOString())
        .in("outcome", ACTIVE_OUTCOMES)
        .limit(50)
    : Promise.resolve({ data: [] as Array<Record<string, unknown>> });

  const [overdueRes, todayRes, mineRes, poolRes, slaPoolRes, slaResponseRes] = await Promise.all([
    overdueQ, todayQ, mineQ, poolQ, slaPoolQ, slaResponseQ,
  ]);

  // For specialists, filter overdue+today to those assigned to them
  type JobRow = { id: string; assigned_to: string | null; [k: string]: unknown };
  // PostgREST's typed response is too strict for our string-based select; cast through unknown.
  const safeRows = (r: { data?: unknown }): JobRow[] =>
    Array.isArray(r.data) ? (r.data as JobRow[]) : [];

  const filterMine = (rows: JobRow[]) =>
    seeAll ? rows : rows.filter((r) => r.assigned_to === user.id);

  const overdueRows = safeRows(overdueRes);
  const todayRows = safeRows(todayRes);
  const mineRows = safeRows(mineRes);
  const poolRows = safeRows(poolRes);
  const slaPoolRows = safeRows(slaPoolRes);
  const slaResponseRows = safeRows(slaResponseRes);

  // Resolve assignee emails for visible jobs (best-effort, max ~10 distinct)
  const allJobs = [...overdueRows, ...todayRows, ...mineRows, ...poolRows, ...slaPoolRows, ...slaResponseRows];
  const assigneeIds = Array.from(new Set(allJobs.map((j) => j.assigned_to).filter(Boolean))) as string[];
  const assignees: Record<string, { email: string }> = {};
  for (const uid of assigneeIds) {
    try {
      const { data } = await adminSupabase.auth.admin.getUserById(uid);
      if (data?.user?.email) assignees[uid] = { email: data.user.email };
    } catch { /* ignore */ }
  }

  // Counters for the dashboard header
  const counts = {
    overdue: filterMine(overdueRows).length,
    today: filterMine(todayRows).length,
    mine: mineRows.length,
    pool: poolRows.length,
    sla_pool: slaPoolRows.length,
    sla_response: slaResponseRows.length,
  };

  return NextResponse.json({
    role,
    canSeeAll: seeAll,
    counts,
    overdue: filterMine(overdueRows),
    today: filterMine(todayRows),
    mine: mineRows,
    pool: poolRows,
    sla_pool: slaPoolRows,
    sla_response: slaResponseRows,
    assignees,
  });
}
