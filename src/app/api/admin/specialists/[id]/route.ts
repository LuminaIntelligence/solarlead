/**
 * GET /api/admin/specialists/[id]
 *
 * Liefert eine umfassende Pipeline-Sicht für einen User:
 *   - Specialist-Info
 *   - ALLE outreach_jobs mit assigned_to = user (pending/sent/replied/cancelled)
 *   - ALLE solar_lead_mass mit user_id = user (selbst angelegte Leads)
 *   - Aktivitäts-Feed (outreach_activities)
 *
 * Damit der Admin sieht: was hat dieser User in Bearbeitung,
 * was hat er selbst erstellt, was läuft gerade in welchem Status.
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

  // 1) Specialist-Info
  const { data: specialist } = await adminSupabase
    .from("user_settings")
    .select("user_id, email, role")
    .eq("user_id", id)
    .maybeSingle();

  if (!specialist) {
    return NextResponse.json({ error: "User nicht gefunden" }, { status: 404 });
  }

  // 2) ALLE Outreach-Jobs die diesem User zugewiesen sind
  //    (nicht nur replied — auch pending/sent/cancelled)
  const { data: assignedJobs } = await adminSupabase
    .from("outreach_jobs")
    .select(
      "id, lead_id, status, channel, " +
        "contact_name, contact_email, contact_title, " +
        "company_name, company_city, company_category, " +
        "outcome, outcome_at, replied_at, reply_content, " +
        "last_activity_at, scheduled_for, closed_value_eur, " +
        "next_action_at, created_at, sent_at, linkedin_sent_at, " +
        "solar_lead_mass(total_score, status)"
    )
    .eq("assigned_to", id)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(2000);

  // 3) ALLE Leads die dieser User selbst angelegt hat (Discovery, Manuell)
  //    — auch wenn keine Outreach-Jobs dranhängen
  const { data: ownedLeads } = await adminSupabase
    .from("solar_lead_mass")
    .select(
      "id, company_name, city, category, total_score, status, " +
        "created_at, updated_at, linkedin_url"
    )
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(2000);

  // 4) Activity-Feed (letzte 50 Einträge wo dieser User aktiv war)
  const { data: activities } = await adminSupabase
    .from("outreach_activities")
    .select("id, job_id, kind, content, created_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Counts berechnen
  type JobRow = {
    status?: string | null;
    outcome?: string | null;
    closed_value_eur?: number | string | null;
  };
  const assigned = (assignedJobs ?? []) as JobRow[];
  const counts_by_status: Record<string, number> = {};
  const counts_by_outcome: Record<string, number> = {};
  let totalWonValue = 0;
  for (const j of assigned) {
    const st = (j.status as string) || "unknown";
    counts_by_status[st] = (counts_by_status[st] ?? 0) + 1;
    if (j.outcome) {
      counts_by_outcome[j.outcome] = (counts_by_outcome[j.outcome] ?? 0) + 1;
      if (j.outcome === "closed_won" && j.closed_value_eur) {
        totalWonValue += Number(j.closed_value_eur);
      }
    }
  }

  type LeadRow = { status?: string | null };
  const owned = (ownedLeads ?? []) as LeadRow[];
  const owned_counts_by_status: Record<string, number> = {};
  for (const l of owned) {
    const st = (l.status as string) || "unknown";
    owned_counts_by_status[st] = (owned_counts_by_status[st] ?? 0) + 1;
  }

  return NextResponse.json({
    specialist,
    assigned_jobs: assignedJobs ?? [],
    owned_leads: ownedLeads ?? [],
    activities: activities ?? [],
    counts_by_status,
    counts_by_outcome,
    owned_counts_by_status,
    total_won_value_eur: totalWonValue,
  });
}
