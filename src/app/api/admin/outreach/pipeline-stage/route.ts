import { NextRequest, NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { PIPELINE_STAGES } from "@/lib/constants/pipeline";

/**
 * PATCH /api/admin/outreach/pipeline-stage
 * Body: { job_id: string, stage: PipelineStageValue | null }
 * Updates pipeline_stage on the outreach_job.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { supabase } = gate;

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
