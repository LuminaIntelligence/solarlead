import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

export const PIPELINE_STAGES = [
  { value: "interested", label: "Interessiert", color: "bg-blue-100 text-blue-700" },
  { value: "meeting_scheduled", label: "Termin vereinbart", color: "bg-purple-100 text-purple-700" },
  { value: "offer_sent", label: "Angebot gesendet", color: "bg-yellow-100 text-yellow-700" },
  { value: "closed_won", label: "Gewonnen 🎉", color: "bg-green-100 text-green-700" },
  { value: "closed_lost", label: "Verloren", color: "bg-slate-100 text-slate-500" },
] as const;

export type PipelineStageValue = (typeof PIPELINE_STAGES)[number]["value"];

/**
 * PATCH /api/admin/outreach/pipeline-stage
 * Body: { job_id: string, stage: PipelineStageValue | null }
 * Updates pipeline_stage on the outreach_job.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { job_id, stage } = body as { job_id: string; stage: string | null };

  if (!job_id) return NextResponse.json({ error: "job_id required" }, { status: 400 });

  const validStages = PIPELINE_STAGES.map((s) => s.value) as string[];
  if (stage !== null && !validStages.includes(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const { error } = await supabase
    .from("outreach_jobs")
    .update({ pipeline_stage: stage })
    .eq("id", job_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, stage });
}
