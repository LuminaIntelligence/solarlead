import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEnrichmentProvider } from "@/lib/providers/enrichment";
import { saveEnrichment } from "@/lib/actions/leads";
import { getUserSettings } from "@/lib/actions/settings";
import { calculateScore } from "@/lib/scoring";

const EnrichRequestSchema = z.object({
  lead_id: z.string().uuid(),
  website: z.string().min(1),
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
    const parsed = EnrichRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { lead_id, website } = parsed.data;

    // Verify lead belongs to user
    const { data: lead, error: leadError } = await supabase
      .from("solar_lead_mass")
      .select("*")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Immer live: Firecrawl/Enrichment-Key kommt aus Env-Vars
    const provider = getEnrichmentProvider("live");
    const enrichmentResult = await provider.enrich({ website });

    if (!enrichmentResult) {
      return NextResponse.json(
        { error: "Enrichment returned no results" },
        { status: 422 }
      );
    }

    // Save enrichment to DB
    const savedEnrichment = await saveEnrichment({
      lead_id,
      website_title: enrichmentResult.website_title,
      meta_description: enrichmentResult.meta_description,
      detected_keywords: enrichmentResult.detected_keywords,
      enrichment_score: enrichmentResult.enrichment_score,
    });

    // Recalculate and update lead scores
    const settings = await getUserSettings();
    const weights = settings?.scoring_weights ?? undefined;

    // Fetch solar data if it exists
    const { data: solarData } = await supabase
      .from("solar_assessments")
      .select("solar_quality, max_array_panels_count, max_array_area_m2, annual_energy_kwh")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const scoring = calculateScore(
      {
        category: lead.category,
        solarData: solarData || undefined,
        enrichmentData: {
          detected_keywords: enrichmentResult.detected_keywords,
          enrichment_score: enrichmentResult.enrichment_score,
        },
        hasWebsite: !!lead.website,
        hasPhone: !!lead.phone,
        hasEmail: !!lead.email,
      },
      weights
    );

    // Update lead scores
    await supabase
      .from("solar_lead_mass")
      .update({
        business_score: scoring.business_score,
        electricity_score: scoring.electricity_score,
        outreach_score: scoring.outreach_score,
        solar_score: scoring.solar_score,
        total_score: scoring.total_score,
      })
      .eq("id", lead_id);

    return NextResponse.json({
      enrichment: savedEnrichment,
      scores: {
        business_score: scoring.business_score,
        electricity_score: scoring.electricity_score,
        outreach_score: scoring.outreach_score,
        solar_score: scoring.solar_score,
        total_score: scoring.total_score,
      },
    });
  } catch (error) {
    console.error("Enrich API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
