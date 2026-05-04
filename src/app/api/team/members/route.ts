/**
 * GET /api/team/members
 *
 * List of all team members (reply_specialist + team_lead + admin).
 * Used by the re-assign dropdown — only callable by lead/admin.
 *
 * Returns id, email, role, and current open workload (so leads can
 * pick the least-loaded specialist).
 */
import { NextResponse } from "next/server";
import { requireTeamMember, canSeeAllReplies } from "@/lib/auth/admin-gate";

const ACTIVE = ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"];

export async function GET() {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { role, adminSupabase } = gate;
  if (!canSeeAllReplies(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: members } = await adminSupabase
    .from("user_settings")
    .select("user_id, role")
    .in("role", ["reply_specialist", "team_lead", "admin"]);

  const out: Array<{ id: string; email: string | null; role: string; open_count: number }> = [];
  for (const m of members ?? []) {
    const uid = m.user_id as string;
    const { count } = await adminSupabase
      .from("outreach_jobs")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", uid)
      .in("outcome", ACTIVE);
    const { data: { user } } = await adminSupabase.auth.admin.getUserById(uid);
    out.push({
      id: uid,
      email: user?.email ?? null,
      role: m.role as string,
      open_count: count ?? 0,
    });
  }

  // Sort by open count asc (least loaded first)
  out.sort((a, b) => a.open_count - b.open_count);

  return NextResponse.json({ members: out });
}
