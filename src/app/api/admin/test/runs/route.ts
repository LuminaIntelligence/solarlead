import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/test/runs
 * Liste aller Test-Batches mit Stats (Sent/Delivered/Opened/Clicked/Replied).
 * Per-Batch-Aggregation.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const sb = createAdminClient();
  const { data: batches } = await sb
    .from("outreach_batches")
    .select("id, name, status, created_at")
    .eq("is_test_data", true)
    .order("created_at", { ascending: false });

  const runs = await Promise.all(
    (batches ?? []).map(async (b) => {
      const { data: jobs } = await sb
        .from("outreach_jobs")
        .select("status, sent_at, delivered_at, opened_at, clicked_at, replied_at, bounced_at")
        .eq("batch_id", b.id);

      const total = jobs?.length ?? 0;
      const sent = jobs?.filter((j) => j.sent_at).length ?? 0;
      const delivered = jobs?.filter((j) => j.delivered_at).length ?? 0;
      const opened = jobs?.filter((j) => j.opened_at).length ?? 0;
      const clicked = jobs?.filter((j) => j.clicked_at).length ?? 0;
      const replied = jobs?.filter((j) => j.replied_at).length ?? 0;
      const bounced = jobs?.filter((j) => j.bounced_at).length ?? 0;

      return {
        id: b.id,
        name: b.name,
        status: b.status,
        created_at: b.created_at,
        stats: { total, sent, delivered, opened, clicked, replied, bounced },
      };
    })
  );

  return NextResponse.json({ runs });
}
