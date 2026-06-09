/**
 * GET /api/admin/specialists/[id]
 *
 * Liefert alle Outreach-Jobs die einem Specialist (auth.users.id)
 * zugewiesen sind, inkl. Lead-Daten und Aktivitäts-Stempel.
 *
 * Response:
 *   {
 *     specialist: { id, email, role, total_score?, ... }
 *     jobs: [{ id, company_name, score, outcome, last_activity_at, ... }]
 *     counts_by_outcome: { new: X, in_progress: Y, ... }
 *   }
 */

import { NextResponse } from "next/server";
import { requireTeamMember, canSeeAllReplies } from "@/lib/auth/admin-gate";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { role, adminSupabase } = gate;
  if (!canSeeAllReplies(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Specialist-Info aus user_settings (email + role)
  const { data: specialist } = await adminSupabase
    .from("user_settings")
    .select("user_id, email, role")
    .eq("user_id", id)
    .maybeSingle();

  if (!specialist) {
    return NextResponse.json({ error: "Specialist nicht gefunden" }, { status: 404 });
  }

  // Alle Jobs für diesen Specialist
  const { data: jobs, error: jErr } = await adminSupabase
    .from("outreach_jobs")
    .select(
      "id, lead_id, status, channel, " +
        "contact_name, contact_email, contact_title, " +
        "company_name, company_city, company_category, " +
        "outcome, outcome_at, replied_at, reply_content, " +
        "last_activity_at, scheduled_for, closed_value_eur, " +
        "next_action_at, " +
        "solar_lead_mass(total_score, status)"
    )
    .eq("assigned_to", id)
    .eq("status", "replied")
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(1000);

  if (jErr) {
    return NextResponse.json({ error: jErr.message }, { status: 500 });
  }

  // Counts pro Outcome
  const counts: Record<string, number> = {};
  let totalWonValue = 0;
  type JobRow = {
    outcome?: string | null;
    closed_value_eur?: number | string | null;
  };
  for (const j of (jobs ?? []) as JobRow[]) {
    const oc = (j.outcome as string) || "new";
    counts[oc] = (counts[oc] ?? 0) + 1;
    if (oc === "closed_won" && j.closed_value_eur) {
      totalWonValue += Number(j.closed_value_eur);
    }
  }

  // Letzte 20 Activity-Einträge dieses Specialists für eine Mini-Timeline
  const { data: activities } = await adminSupabase
    .from("outreach_activities")
    .select("id, job_id, kind, content, created_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    specialist,
    jobs: jobs ?? [],
    counts,
    total_won_value_eur: totalWonValue,
    activities: activities ?? [],
  });
}
