import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/actions/settings";
import { findLinkedInProfile } from "@/lib/providers/linkedin/finder";

const LinkedInRequestSchema = z.object({
  lead_id: z.string().uuid(),
  company_name: z.string().min(1),
  city: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = LinkedInRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { lead_id, company_name, city } = parsed.data;

    // Verify lead belongs to user
    const { data: lead, error: leadError } = await supabase
      .from("solar_lead_mass")
      .select("id, linkedin_url")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
    }

    // Wenn schon eine LinkedIn-URL vorhanden ist, nicht nochmal suchen
    if (lead.linkedin_url) {
      return NextResponse.json({
        linkedin_url: lead.linkedin_url,
        confidence: "existing",
        cached: true,
      });
    }

    // Google Search API Key aus Einstellungen oder Env
    const settings = await getUserSettings();
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY || settings?.google_places_api_key || undefined;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || undefined;

    const result = await findLinkedInProfile(company_name, city, apiKey, searchEngineId);

    // Wenn gefunden, am Lead speichern
    if (result.linkedin_url) {
      await supabase
        .from("solar_lead_mass")
        .update({ linkedin_url: result.linkedin_url })
        .eq("id", lead_id);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("LinkedIn API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
