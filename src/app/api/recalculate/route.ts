import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/scoring";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user settings for weights
    const { data: settings } = await supabase
      .from("user_settings")
      .select("scoring_weights")
      .eq("user_id", user.id)
      .single();

    const weights = settings?.scoring_weights ?? undefined;

    // Get all leads
    const { data: leads, error } = await supabase
      .from("solar_lead_mass")
      .select("id, category, website, phone, email")
      .eq("user_id", user.id);

    if (error || !leads) {
      return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }

    let updated = 0;

    for (const lead of leads) {
      // Get solar data
      const { data: solarData } = await supabase
        .from("solar_assessments")
        .select("solar_quality, max_array_panels_count, max_array_area_m2, annual_energy_kwh")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Get enrichment data
      const { data: enrichmentData } = await supabase
        .from("lead_enrichment")
        .select("detected_keywords, enrichment_score")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const scoring = calculateScore(
        {
          category: lead.category,
          solarData: solarData ?? undefined,
          enrichmentData: enrichmentData ?? undefined,
          hasWebsite: !!lead.website,
          hasPhone: !!lead.phone,
          hasEmail: !!lead.email,
        },
        weights
      );

      await supabase
        .from("solar_lead_mass")
        .update({
          business_score: scoring.business_score,
          electricity_score: scoring.electricity_score,
          solar_score: scoring.solar_score,
          outreach_score: scoring.outreach_score,
          total_score: scoring.total_score,
        })
        .eq("id", lead.id);

      updated++;
    }

    return NextResponse.json({ updated });
  } catch (error) {
    console.error("Recalculate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
