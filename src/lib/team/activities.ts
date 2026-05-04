/**
 * Activity-log helpers for the reply-team workflow.
 *
 * Every meaningful action (claim, reassign, outcome change, note,
 * call attempt) writes a row into outreach_activities. The trigger on
 * insert auto-bumps outreach_jobs.last_activity_at, which the SLA dashboard
 * uses to detect "stuck" replies.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityKind } from "@/types/database";

export interface ActivityInput {
  job_id: string;
  user_id: string;
  kind: ActivityKind;
  content?: string | null;
  context?: Record<string, unknown> | null;
}

export async function recordActivity(
  adminSupabase: ReturnType<typeof createAdminClient>,
  input: ActivityInput
): Promise<void> {
  try {
    await adminSupabase.from("outreach_activities").insert({
      job_id: input.job_id,
      user_id: input.user_id,
      kind: input.kind,
      content: input.content ?? null,
      context: input.context ?? null,
    });
  } catch (e) {
    console.error("[recordActivity] failed:", e);
  }
}
