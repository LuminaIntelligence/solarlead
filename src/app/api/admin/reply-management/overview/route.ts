/**
 * GET /api/admin/reply-management/overview
 *
 * Big-picture dashboard for admins / team-leads.
 *
 * Returns:
 *   - kpis              : counters for today/week/month
 *   - funnel            : reply → termin → angebot → win counts
 *   - team              : per-specialist workload + monthly performance
 *   - activity_feed     : last 50 outreach_activities (with user emails)
 *   - sla_violations    : pool >3h, response >24h
 *   - daily_trend       : last 14 days reply intake + closes
 */
import { NextResponse } from "next/server";
import { requireTeamMember, canSeeAllReplies } from "@/lib/auth/admin-gate";
import { ACTIVITY_KIND_LABELS, OUTCOME_OPTIONS, SLA } from "@/lib/constants/reply-outcomes";

const ACTIVE = ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"];
const TERMINAL = ["closed_won", "closed_lost", "not_interested"];

export async function GET() {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { role, adminSupabase } = gate;
  if (!canSeeAllReplies(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7); startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const slaPoolThreshold = new Date(now.getTime() - SLA.ASSIGN_HOURS * 60 * 60 * 1000);
  const slaResponseThreshold = new Date(now.getTime() - SLA.RESPOND_HOURS * 60 * 60 * 1000);

  const baseRepliedQ = () => adminSupabase
    .from("outreach_jobs").select("id", { count: "exact", head: true }).eq("status", "replied");

  // ─── 1. KPIs ────────────────────────────────────────────────────────────
  const [
    repliesToday, repliesYesterday, repliesThisWeek,
    winsThisMonth, winsLastMonth, openTotal, poolTotal,
  ] = await Promise.all([
    baseRepliedQ().gte("replied_at", startOfToday.toISOString()),
    baseRepliedQ().gte("replied_at", startOfYesterday.toISOString()).lt("replied_at", startOfToday.toISOString()),
    baseRepliedQ().gte("replied_at", startOfWeek.toISOString()),
    baseRepliedQ().eq("outcome", "closed_won").gte("outcome_at", startOfMonth.toISOString()),
    baseRepliedQ().eq("outcome", "closed_won")
      .gte("outcome_at", new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() - 1, 1).toISOString())
      .lt("outcome_at", startOfMonth.toISOString()),
    baseRepliedQ().in("outcome", ACTIVE),
    baseRepliedQ().is("assigned_to", null),
  ]);

  // Sum of won deal values this month
  const { data: wonMonth } = await adminSupabase
    .from("outreach_jobs")
    .select("closed_value_eur")
    .eq("outcome", "closed_won")
    .gte("outcome_at", startOfMonth.toISOString());
  const wonValueMonthEur = (wonMonth ?? []).reduce((s, r) => s + Number(r.closed_value_eur ?? 0), 0);

  // ─── 2. Funnel (this month) ─────────────────────────────────────────────
  const [funnelReplies, funnelAppt, funnelOffer, funnelWin, funnelLost] = await Promise.all([
    baseRepliedQ().gte("replied_at", startOfMonth.toISOString()),
    baseRepliedQ().eq("outcome", "appointment_set").gte("outcome_at", startOfMonth.toISOString()),
    baseRepliedQ().eq("pipeline_stage", "offer_sent").gte("outcome_at", startOfMonth.toISOString()),
    baseRepliedQ().eq("outcome", "closed_won").gte("outcome_at", startOfMonth.toISOString()),
    baseRepliedQ().eq("outcome", "closed_lost").gte("outcome_at", startOfMonth.toISOString()),
  ]);

  // ─── 3. Team workload ───────────────────────────────────────────────────
  const { data: teamMembers } = await adminSupabase
    .from("user_settings")
    .select("user_id, role")
    .in("role", ["reply_specialist", "team_lead", "admin"]);

  type TeamRow = {
    user_id: string;
    email: string | null;
    role: string;
    open: number;
    overdue: number;
    won_month: number;
    lost_month: number;
    not_int_month: number;
    won_value_month_eur: number;
    win_rate: number;
    last_activity_at: string | null;
  };
  const team: TeamRow[] = [];

  for (const m of teamMembers ?? []) {
    const uid = m.user_id as string;
    const baseAssigned = () => adminSupabase
      .from("outreach_jobs").select("id", { count: "exact", head: true }).eq("assigned_to", uid);

    const [openC, overdueC, wonC, lostC, notIntC] = await Promise.all([
      baseAssigned().in("outcome", ACTIVE),
      baseAssigned().lt("next_action_at", now.toISOString()).in("outcome", ACTIVE),
      baseAssigned().eq("outcome", "closed_won").gte("outcome_at", startOfMonth.toISOString()),
      baseAssigned().eq("outcome", "closed_lost").gte("outcome_at", startOfMonth.toISOString()),
      baseAssigned().eq("outcome", "not_interested").gte("outcome_at", startOfMonth.toISOString()),
    ]);
    const won = wonC.count ?? 0;
    const lost = lostC.count ?? 0;
    const notInt = notIntC.count ?? 0;
    const closed = won + lost + notInt;

    const { data: wins } = await adminSupabase
      .from("outreach_jobs")
      .select("closed_value_eur")
      .eq("assigned_to", uid)
      .eq("outcome", "closed_won")
      .gte("outcome_at", startOfMonth.toISOString());
    const wonValue = (wins ?? []).reduce((s, r) => s + Number(r.closed_value_eur ?? 0), 0);

    // last activity in any job
    const { data: lastAct } = await adminSupabase
      .from("outreach_activities")
      .select("created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: { user } } = await adminSupabase.auth.admin.getUserById(uid);

    team.push({
      user_id: uid,
      email: user?.email ?? null,
      role: m.role as string,
      open: openC.count ?? 0,
      overdue: overdueC.count ?? 0,
      won_month: won,
      lost_month: lost,
      not_int_month: notInt,
      won_value_month_eur: wonValue,
      win_rate: closed > 0 ? won / closed : 0,
      last_activity_at: lastAct?.created_at ?? null,
    });
  }
  // Sort: leads first, then by open desc
  team.sort((a, b) => {
    const roleOrder = (r: string) => (r === "admin" ? 0 : r === "team_lead" ? 1 : 2);
    if (roleOrder(a.role) !== roleOrder(b.role)) return roleOrder(a.role) - roleOrder(b.role);
    return b.open - a.open;
  });

  // ─── 4. Live activity feed (last 50) ─────────────────────────────────────
  const { data: activities } = await adminSupabase
    .from("outreach_activities")
    .select("id, job_id, user_id, kind, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  // Resolve job names + user emails
  const jobIds = Array.from(new Set((activities ?? []).map((a) => a.job_id as string)));
  const userIds = Array.from(new Set((activities ?? []).map((a) => a.user_id as string)));
  const [jobInfo, userInfo] = await Promise.all([
    jobIds.length
      ? adminSupabase.from("outreach_jobs").select("id, company_name").in("id", jobIds)
      : Promise.resolve({ data: [] }),
    Promise.all(userIds.map(async (uid) => {
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(uid);
        return { uid, email: data?.user?.email ?? null };
      } catch { return { uid, email: null }; }
    })),
  ]);
  const jobNameById: Record<string, string> = {};
  for (const j of (jobInfo.data ?? []) as Array<{ id: string; company_name: string | null }>) {
    jobNameById[j.id] = j.company_name ?? "(ohne Name)";
  }
  const userEmailById: Record<string, string | null> = {};
  for (const u of userInfo) userEmailById[u.uid] = u.email;

  const activityFeed = (activities ?? []).map((a) => ({
    id: a.id,
    job_id: a.job_id,
    job_name: jobNameById[a.job_id as string] ?? "—",
    user_email: userEmailById[a.user_id as string] ?? "?",
    kind: a.kind,
    kind_label: ACTIVITY_KIND_LABELS[a.kind as keyof typeof ACTIVITY_KIND_LABELS]?.label ?? a.kind,
    content: a.content,
    created_at: a.created_at,
  }));

  // ─── 5. SLA violations (with assignee email) ────────────────────────────
  const [slaPoolRes, slaRespRes] = await Promise.all([
    adminSupabase.from("outreach_jobs")
      .select("id, company_name, replied_at, contact_name")
      .is("assigned_to", null).eq("status", "replied")
      .lt("replied_at", slaPoolThreshold.toISOString())
      .order("replied_at", { ascending: true }).limit(20),
    adminSupabase.from("outreach_jobs")
      .select("id, company_name, last_activity_at, assigned_to, outcome")
      .not("assigned_to", "is", null).in("outcome", ACTIVE)
      .lt("last_activity_at", slaResponseThreshold.toISOString())
      .order("last_activity_at", { ascending: true }).limit(20),
  ]);

  const slaRespAssigneeEmails: Record<string, string | null> = {};
  for (const j of (slaRespRes.data ?? []) as Array<{ assigned_to: string | null }>) {
    if (j.assigned_to && !(j.assigned_to in slaRespAssigneeEmails)) {
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(j.assigned_to);
        slaRespAssigneeEmails[j.assigned_to] = data?.user?.email ?? null;
      } catch { slaRespAssigneeEmails[j.assigned_to] = null; }
    }
  }

  // ─── 6. Daily trend (last 14 days) ──────────────────────────────────────
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(now.getDate() - 14); fourteenDaysAgo.setHours(0, 0, 0, 0);
  const { data: trendReplies } = await adminSupabase
    .from("outreach_jobs")
    .select("replied_at, outcome, outcome_at")
    .gte("replied_at", fourteenDaysAgo.toISOString());
  const dailyTrend: Record<string, { date: string; replies: number; wins: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    dailyTrend[key] = { date: key, replies: 0, wins: 0 };
  }
  for (const r of (trendReplies ?? []) as Array<{ replied_at: string; outcome: string; outcome_at: string | null }>) {
    if (r.replied_at) {
      const k = r.replied_at.slice(0, 10);
      if (dailyTrend[k]) dailyTrend[k].replies++;
    }
    if (r.outcome === "closed_won" && r.outcome_at) {
      const k = r.outcome_at.slice(0, 10);
      if (dailyTrend[k]) dailyTrend[k].wins++;
    }
  }

  return NextResponse.json({
    kpis: {
      replies_today: repliesToday.count ?? 0,
      replies_yesterday: repliesYesterday.count ?? 0,
      replies_week: repliesThisWeek.count ?? 0,
      wins_month: winsThisMonth.count ?? 0,
      wins_last_month: winsLastMonth.count ?? 0,
      won_value_month_eur: wonValueMonthEur,
      open_total: openTotal.count ?? 0,
      pool_total: poolTotal.count ?? 0,
    },
    funnel: {
      replies: funnelReplies.count ?? 0,
      appointments: funnelAppt.count ?? 0,
      offers: funnelOffer.count ?? 0,
      wins: funnelWin.count ?? 0,
      lost: funnelLost.count ?? 0,
    },
    team,
    activity_feed: activityFeed,
    sla_violations: {
      pool: slaPoolRes.data ?? [],
      response: ((slaRespRes.data ?? []) as Array<{ assigned_to: string | null }>).map((j) => ({
        ...j,
        assignee_email: j.assigned_to ? slaRespAssigneeEmails[j.assigned_to] : null,
      })),
    },
    daily_trend: Object.values(dailyTrend),
    outcome_meta: OUTCOME_OPTIONS,
  });
}
