import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDiscoveryCampaign } from "@/lib/discovery/engine";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// POST /api/admin/discovery/[id]/run — (re)start a paused or failed campaign
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: campaign } = await supabase
    .from("discovery_campaigns")
    .select("status")
    .eq("id", id)
    .single();

  if (!campaign) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (campaign.status === "running") {
    return NextResponse.json({ error: "Kampagne läuft bereits" }, { status: 409 });
  }

  // Reset to pending so engine can pick it up
  await supabase
    .from("discovery_campaigns")
    .update({ status: "pending", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  setImmediate(() => {
    runDiscoveryCampaign(id).catch((e) =>
      console.error("[Discovery] Re-run failed:", e)
    );
  });

  return NextResponse.json({ ok: true, message: "Kampagne wird neu gestartet" });
}
