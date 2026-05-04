/**
 * Per-job endpoint for the reply-team workflow.
 *
 * GET    → Returns the job + its activity log + lead context (company, score,
 *          contacts, original outreach email).
 * PATCH  → Update outcome, next_action_at, next_action_note, pipeline_stage,
 *          closed_value_eur, or notes (note creates an activity entry).
 *
 * Visibility:
 *   - admin / team_lead: any job
 *   - reply_specialist: only assigned-to-self OR unassigned (pool)
 *
 * Mutating PATCH always logs an outreach_activities entry so the audit log
 * stays complete.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember, requireTeamMemberAndOrigin, canSeeAllReplies } from "@/lib/auth/admin-gate";
import { recordActivity } from "@/lib/team/activities";
import { OUTCOME_OPTIONS, outcomeMeta } from "@/lib/constants/reply-outcomes";

const PatchSchema = z.object({
  outcome: z.enum(OUTCOME_OPTIONS.map((o) => o.value) as [string, ...string[]]).optional(),
  next_action_at: z.string().nullable().optional(),
  next_action_note: z.string().nullable().optional(),
  pipeline_stage: z.string().nullable().optional(),
  closed_value_eur: z.number().nullable().optional(),
  /** Free-form note added as an activity (not stored on the job row). */
  note: z.string().min(1).optional(),
});

/** Confirms the user can see this job. */
async function canAccessJob(
  adminSupabase: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  jobId: string,
  userId: string,
  role: string
): Promise<{ ok: boolean; job?: Record<string, unknown> }> {
  const { data: job } = await adminSupabase
    .from("outreach_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false };
  if (canSeeAllReplies(role)) return { ok: true, job: job as Record<string, unknown> };
  // reply_specialist: own assigned OR pool (assigned_to is null)
  if (job.assigned_to === userId || job.assigned_to == null) {
    return { ok: true, job: job as Record<string, unknown> };
  }
  return { ok: false };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMember();
  if (gate.error) return gate.error;
  const { user, role, adminSupabase } = gate;
  const { id } = await params;

  const access = await canAccessJob(adminSupabase, id, user.id, role);
  if (!access.ok) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const job = access.job!;

  // Lead, contacts, batch — all in parallel for speed
  const [leadRes, contactsRes, batchRes, activitiesRes, assigneeRes] = await Promise.all([
    job.lead_id
      ? adminSupabase.from("solar_lead_mass").select("*").eq("id", job.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.lead_id
      ? adminSupabase.from("lead_contacts").select("*").eq("lead_id", job.lead_id).order("is_primary", { ascending: false })
      : Promise.resolve({ data: [] }),
    job.batch_id
      ? adminSupabase.from("outreach_batches").select("id, name, template_type, created_at").eq("id", job.batch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    adminSupabase.from("outreach_activities").select("*").eq("job_id", id).order("created_at", { ascending: false }).limit(100),
    job.assigned_to
      ? adminSupabase.auth.admin.getUserById(job.assigned_to as string)
      : Promise.resolve({ data: { user: null } }),
  ]);

  // Resolve user IDs in activities to display names/emails (best-effort)
  const userIds = new Set<string>([...(activitiesRes.data ?? []).map((a) => a.user_id as string)]);
  const userEmails: Record<string, string> = {};
  for (const uid of userIds) {
    if (!uid) continue;
    try {
      const { data } = await adminSupabase.auth.admin.getUserById(uid);
      if (data?.user?.email) userEmails[uid] = data.user.email;
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    job,
    lead: leadRes.data ?? null,
    contacts: contactsRes.data ?? [],
    batch: batchRes.data ?? null,
    activities: activitiesRes.data ?? [],
    assignee: assigneeRes.data?.user ? {
      id: (assigneeRes.data.user as { id: string }).id,
      email: (assigneeRes.data.user as { email: string }).email,
    } : null,
    userEmails,
    outcomeMeta: outcomeMeta(job.outcome as never),
    role,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireTeamMemberAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, role, adminSupabase } = gate;
  const { id } = await params;

  const access = await canAccessJob(adminSupabase, id, user.id, role);
  if (!access.ok) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const oldJob = access.job!;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Daten", details: parsed.error.flatten() }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const activities: Array<{ kind: import("@/types/database").ActivityKind; content: string; context?: Record<string, unknown> }> = [];

  if (parsed.data.outcome != null && parsed.data.outcome !== oldJob.outcome) {
    updates.outcome = parsed.data.outcome;
    updates.outcome_at = new Date().toISOString();
    activities.push({
      kind: "outcome_changed",
      content: `Outcome: ${outcomeMeta(oldJob.outcome as never).label} → ${outcomeMeta(parsed.data.outcome as never).label}`,
      context: { old: oldJob.outcome, new: parsed.data.outcome },
    });
  }
  if (parsed.data.next_action_at !== undefined) {
    updates.next_action_at = parsed.data.next_action_at;
    if (parsed.data.next_action_at) {
      activities.push({
        kind: "reminder_set",
        content: `Wiedervorlage: ${new Date(parsed.data.next_action_at).toLocaleString("de-DE")}`,
        context: { next_action_at: parsed.data.next_action_at },
      });
    }
  }
  if (parsed.data.next_action_note !== undefined) {
    updates.next_action_note = parsed.data.next_action_note;
  }
  if (parsed.data.pipeline_stage !== undefined && parsed.data.pipeline_stage !== oldJob.pipeline_stage) {
    updates.pipeline_stage = parsed.data.pipeline_stage;
    activities.push({
      kind: "stage_changed",
      content: `Pipeline: ${oldJob.pipeline_stage ?? "—"} → ${parsed.data.pipeline_stage ?? "—"}`,
      context: { old: oldJob.pipeline_stage, new: parsed.data.pipeline_stage },
    });
  }
  if (parsed.data.closed_value_eur !== undefined) {
    updates.closed_value_eur = parsed.data.closed_value_eur;
  }

  // Notes are stored as activity rows, not on the job
  if (parsed.data.note) {
    activities.push({ kind: "note", content: parsed.data.note });
  }

  // Apply DB update if there were field changes
  let updatedJob = oldJob;
  if (Object.keys(updates).length > 0) {
    const { data, error } = await adminSupabase
      .from("outreach_jobs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updatedJob = data as Record<string, unknown>;
  }

  // Write activities
  for (const a of activities) {
    await recordActivity(adminSupabase, {
      job_id: id,
      user_id: user.id,
      kind: a.kind,
      content: a.content,
      context: a.context ?? null,
    });
  }

  return NextResponse.json({ job: updatedJob, activities_logged: activities.length });
}
