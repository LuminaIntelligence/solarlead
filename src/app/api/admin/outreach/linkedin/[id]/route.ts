import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

/**
 * GET /api/admin/outreach/linkedin/[id]
 * Holt einen einzelnen LinkedIn-Job inkl. Lead-Daten + Templates.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;
  const { id } = await params;

  const { data: job, error } = await supabase
    .from("outreach_jobs")
    .select(
      "*, outreach_batches(name)"
    )
    .eq("id", id)
    .eq("channel", "linkedin")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  }

  // Templates für Editor
  const { data: templates } = await supabase
    .from("linkedin_templates")
    .select("id, name, subject, body, is_default")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");

  return NextResponse.json({ job, templates: templates ?? [] });
}
