/**
 * Round-robin auto-assignment for incoming replies.
 *
 * Strategy: pick the active reply_specialist (or team_lead) with the
 * smallest current open workload. Tie-breaker: longest since last
 * assigned_at. This load-balances naturally without explicit rotation
 * pointer.
 *
 * Called from:
 *   - /api/admin/outreach/sync-replies (after IMAP sync flips a job to 'replied')
 *   - /api/cron/team-tick (catches anything that slipped through, e.g. webhook)
 *
 * If no eligible specialist exists, the job stays unassigned (visible in
 * the team pool for self-claim by anyone).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { recordActivity } from "./activities";

export interface AutoAssignResult {
  jobId: string;
  assignedTo: string | null;
  assigneeEmail?: string | null;
  reason: "assigned" | "no_specialists" | "already_assigned" | "skipped";
}

/**
 * Pick the next specialist via least-loaded heuristic.
 * Returns null if no active specialist exists.
 */
export async function pickNextSpecialist(
  adminSupabase: ReturnType<typeof createAdminClient>
): Promise<{ user_id: string; email: string | null; open_count: number } | null> {
  // 1. All active reply_specialists + team_leads (leads can also be assigned work)
  const { data: candidates } = await adminSupabase
    .from("user_settings")
    .select("user_id, role")
    .in("role", ["reply_specialist", "team_lead"]);

  if (!candidates?.length) return null;

  // 2. Compute open workload for each
  // Open = status='replied' AND outcome NOT IN terminal states
  const stats: Array<{ user_id: string; open: number; lastAssignedAt: string | null }> = [];
  for (const c of candidates) {
    const { count } = await adminSupabase
      .from("outreach_jobs")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", c.user_id)
      .eq("status", "replied")
      .not("outcome", "in", "(closed_won,closed_lost,not_interested)");

    const { data: lastAssigned } = await adminSupabase
      .from("outreach_jobs")
      .select("assigned_at")
      .eq("assigned_to", c.user_id)
      .not("assigned_at", "is", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    stats.push({
      user_id: c.user_id as string,
      open: count ?? 0,
      lastAssignedAt: lastAssigned?.assigned_at as string | null,
    });
  }

  // 3. Sort: fewest open first, then oldest lastAssignedAt first (round-robin tie-break)
  stats.sort((a, b) => {
    if (a.open !== b.open) return a.open - b.open;
    const aTs = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
    const bTs = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
    return aTs - bTs;
  });

  const winner = stats[0];

  // Get email for logging
  const { data: { user } } = await adminSupabase.auth.admin.getUserById(winner.user_id);
  return { user_id: winner.user_id, email: user?.email ?? null, open_count: winner.open };
}

/**
 * Assign a single job. Idempotent — if already assigned, returns immediately.
 */
export async function autoAssignJob(
  adminSupabase: ReturnType<typeof createAdminClient>,
  jobId: string
): Promise<AutoAssignResult> {
  const { data: job } = await adminSupabase
    .from("outreach_jobs")
    .select("id, assigned_to, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return { jobId, assignedTo: null, reason: "skipped" };
  if (job.assigned_to) {
    return { jobId, assignedTo: job.assigned_to as string, reason: "already_assigned" };
  }
  if (job.status !== "replied") {
    return { jobId, assignedTo: null, reason: "skipped" };
  }

  const pick = await pickNextSpecialist(adminSupabase);
  if (!pick) {
    return { jobId, assignedTo: null, reason: "no_specialists" };
  }

  const now = new Date().toISOString();
  const { error } = await adminSupabase
    .from("outreach_jobs")
    .update({
      assigned_to: pick.user_id,
      assigned_at: now,
      last_activity_at: now,
    })
    .eq("id", jobId)
    .is("assigned_to", null); // race-safe

  if (error) return { jobId, assignedTo: null, reason: "skipped" };

  // Audit log entry
  await recordActivity(adminSupabase, {
    job_id: jobId,
    user_id: pick.user_id,
    kind: "reassigned",
    content: `Auto-zugewiesen via Round-Robin (${pick.open_count} offen vor Zuweisung)`,
    context: { mechanism: "auto_round_robin", open_before: pick.open_count },
  });

  return {
    jobId,
    assignedTo: pick.user_id,
    assigneeEmail: pick.email,
    reason: "assigned",
  };
}

/**
 * Assign all currently-unassigned 'replied' jobs in bulk.
 * Used by the team-tick cron as a safety net.
 */
export async function autoAssignAllPending(
  adminSupabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: number; assigned: number; noSpecialists: boolean }> {
  const { data: pending } = await adminSupabase
    .from("outreach_jobs")
    .select("id")
    .eq("status", "replied")
    .is("assigned_to", null)
    .order("replied_at", { ascending: true })
    .limit(50);

  if (!pending?.length) {
    return { processed: 0, assigned: 0, noSpecialists: false };
  }

  let assigned = 0;
  let noSpecialists = false;
  for (const j of pending) {
    const r = await autoAssignJob(adminSupabase, j.id as string);
    if (r.reason === "assigned") assigned++;
    if (r.reason === "no_specialists") { noSpecialists = true; break; }
  }
  return { processed: pending.length, assigned, noSpecialists };
}
