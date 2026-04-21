import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// GET /api/admin/outreach/[id] — Batch details + jobs
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [batchRes, jobsRes] = await Promise.all([
    supabase.from("outreach_batches").select("*").eq("id", id).single(),
    supabase.from("outreach_jobs").select("*").eq("batch_id", id).order("scheduled_for").order("created_at"),
  ]);

  if (batchRes.error) return NextResponse.json({ error: "Batch nicht gefunden" }, { status: 404 });

  return NextResponse.json({ batch: batchRes.data, jobs: jobsRes.data ?? [] });
}

// PATCH /api/admin/outreach/[id] — Status ändern
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const { data, error } = await supabase
    .from("outreach_batches")
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
