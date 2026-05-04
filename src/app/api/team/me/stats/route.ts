/**
 * GET /api/team/me/stats
 *
 * Personal performance dashboard for the calling user.
 * Returns counts + conversion ratios + recent wins.
 */
import { NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/auth/admin-gate";

const TERMINAL = ["closed_won", "closed_lost", "not_interested"];
const ACTIVE = ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"];

export async function GET() {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { user, adminSupabase } = gate;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const baseAssigned = () => adminSupabase
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", user.id);

  const [
    openCount,
    appointmentsThisMonth,
    wonThisMonth,
    lostThisMonth,
    notInterestedThisMonth,
    totalAssignedEver,
    overdueCount,
  ] = await Promise.all([
    baseAssigned().in("outcome", ACTIVE),
    baseAssigned().eq("outcome", "appointment_set").gte("outcome_at", monthStart.toISOString()),
    baseAssigned().eq("outcome", "closed_won").gte("outcome_at", monthStart.toISOString()),
    baseAssigned().eq("outcome", "closed_lost").gte("outcome_at", monthStart.toISOString()),
    baseAssigned().eq("outcome", "not_interested").gte("outcome_at", monthStart.toISOString()),
    baseAssigned(),
    baseAssigned().lt("next_action_at", now.toISOString()).in("outcome", ACTIVE),
  ]);

  // Sum of closed_won deal value this month
  const { data: wins } = await adminSupabase
    .from("outreach_jobs")
    .select("closed_value_eur, company_name, outcome_at")
    .eq("assigned_to", user.id)
    .eq("outcome", "closed_won")
    .gte("outcome_at", monthStart.toISOString())
    .order("outcome_at", { ascending: false })
    .limit(20);
  const wonValueEur = (wins ?? []).reduce((s, r) => s + Number(r.closed_value_eur ?? 0), 0);

  // Conversion ratios
  const apptCount = appointmentsThisMonth.count ?? 0;
  const winCount = wonThisMonth.count ?? 0;
  const lostCount = lostThisMonth.count ?? 0;
  const notIntCount = notInterestedThisMonth.count ?? 0;
  const closedCount = winCount + lostCount + notIntCount;

  return NextResponse.json({
    user_id: user.id,
    open: openCount.count ?? 0,
    overdue: overdueCount.count ?? 0,
    total_assigned_ever: totalAssignedEver.count ?? 0,
    this_month: {
      appointments: apptCount,
      won: winCount,
      lost: lostCount,
      not_interested: notIntCount,
      closed: closedCount,
      won_value_eur: wonValueEur,
      win_rate: closedCount > 0 ? winCount / closedCount : 0,
    },
    recent_wins: (wins ?? []).slice(0, 5).map((w) => ({
      company: w.company_name,
      value_eur: Number(w.closed_value_eur ?? 0),
      at: w.outcome_at,
    })),
  });
}
