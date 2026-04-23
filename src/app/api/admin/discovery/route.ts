import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDiscoveryCampaign } from "@/lib/discovery/engine";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// GET /api/admin/discovery — list all campaigns
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: campaigns, error } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ campaigns: [], warning: "Tabellen noch nicht angelegt." });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: campaigns ?? [] });
}

// POST /api/admin/discovery — create & start campaign
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, areas, categories, search_keyword, auto_approve_threshold } = body;

  if (!name || !areas?.length || !categories?.length) {
    return NextResponse.json({ error: "Name, Gebiete und Branchen sind erforderlich" }, { status: 400 });
  }

  const { data: campaign, error } = await supabase
    .from("discovery_campaigns")
    .insert({
      created_by: user!.id,
      name,
      description: description ?? null,
      areas,
      categories,
      search_keyword: search_keyword || null,
      auto_approve_threshold: auto_approve_threshold ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Start campaign in background (non-blocking)
  setImmediate(() => {
    runDiscoveryCampaign(campaign.id).catch((e) =>
      console.error("[Discovery] Background run failed:", e)
    );
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
