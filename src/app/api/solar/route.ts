import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSolarProvider } from "@/lib/providers/solar";
import { saveSolarAssessment } from "@/lib/actions/leads";
import { getUserSettings } from "@/lib/actions/settings";
import { getSystemApiKeys } from "@/lib/actions/systemSettings";
import { calculateScore } from "@/lib/scoring";

const SolarRequestSchema = z.object({
  lead_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// ~50m Toleranz für Koordinaten-Matching (ca. 0.0005 Grad)
const COORD_TOLERANCE = 0.0005;

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
    const parsed = SolarRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { lead_id, latitude, longitude } = parsed.data;

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

    // --- Prüfe ob es schon ein vollständiges Assessment für diesen Lead gibt ---
    // maybeSingle() statt single() — kein Fehler-Log wenn keine Zeile vorhanden
    const { data: existingForLead } = await supabase
      .from("solar_assessments")
      .select("*")
      .eq("lead_id", lead_id)
      .not("max_array_panels_count", "is", null)   // nur vollständige Assessments zählen
      .neq("provider", "no_coverage")              // no_coverage-Platzhalter überspringen
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingForLead) {
      // Vollständiges Assessment bereits vorhanden — Scores aktualisieren, kein API-Call
      return await updateScoresAndRespond(supabase, lead, existingForLead, lead_id);
    }

    // --- Prüfe ob ein anderer Lead bereits vollständige Solar-Daten für diese Koordinaten hat ---
    // Nur Einträge mit echten Panel-Daten als Cache verwenden (keine no_coverage/Platzhalter)
    const { data: nearbyAssessments } = await supabase
      .from("solar_assessments")
      .select("*")
      .gte("latitude", latitude - COORD_TOLERANCE)
      .lte("latitude", latitude + COORD_TOLERANCE)
      .gte("longitude", longitude - COORD_TOLERANCE)
      .lte("longitude", longitude + COORD_TOLERANCE)
      .not("max_array_panels_count", "is", null)   // nur echte Daten als Cache verwenden
      .neq("provider", "no_coverage")              // no_coverage nie cachen
      .order("created_at", { ascending: false })
      .limit(1);

    if (nearbyAssessments && nearbyAssessments.length > 0) {
      const cached = nearbyAssessments[0];

      // Solar-Daten für diesen Lead übernehmen (neuer DB-Eintrag, kein API-Call)
      const reusedAssessment = await saveSolarAssessment({
        lead_id,
        provider: cached.provider + "_cached",
        latitude,
        longitude,
        solar_quality: cached.solar_quality,
        max_array_panels_count: cached.max_array_panels_count,
        max_array_area_m2: cached.max_array_area_m2,
        annual_energy_kwh: cached.annual_energy_kwh,
        sunshine_hours: cached.sunshine_hours,
        carbon_offset: cached.carbon_offset,
        segment_count: cached.segment_count,
        panel_capacity_watts: cached.panel_capacity_watts,
        raw_response_json: { ...cached.raw_response_json, reused_from_lead: cached.lead_id },
      });

      return await updateScoresAndRespond(supabase, lead, reusedAssessment ?? cached, lead_id);
    }

    // --- Kein Cache-Hit → API aufrufen ---
    // Immer den System-Key verwenden (Admin-Key), damit alle Nutzer live Daten erhalten
    const systemKeys = await getSystemApiKeys();
    const mode = systemKeys.mode;
    const apiKey = systemKeys.googleSolarApiKey;

    const provider = getSolarProvider(mode, apiKey);
    const solarResult = await provider.assess({ latitude, longitude });

    if (!solarResult) {
      return NextResponse.json(
        { error: "Solar assessment returned no results" },
        { status: 422 }
      );
    }

    // Save solar assessment to DB
    const savedAssessment = await saveSolarAssessment({
      lead_id,
      provider: provider.name,
      latitude,
      longitude,
      solar_quality: solarResult.solar_quality,
      max_array_panels_count: solarResult.max_array_panels_count,
      max_array_area_m2: solarResult.max_array_area_m2,
      annual_energy_kwh: solarResult.annual_energy_kwh,
      sunshine_hours: solarResult.sunshine_hours,
      carbon_offset: solarResult.carbon_offset,
      segment_count: solarResult.segment_count,
      panel_capacity_watts: solarResult.panel_capacity_watts,
      raw_response_json: solarResult.raw_response_json,
    });

    return await updateScoresAndRespond(supabase, lead, savedAssessment ?? solarResult, lead_id);
  } catch (error) {
    console.error("Solar API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

const MIN_ROOF_AREA_M2 = 500; // GreenScout-Mindestgröße für Dachflächen

// Hilfsfunktion: Scores berechnen, Lead updaten, Response zurückgeben
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateScoresAndRespond(supabase: any, lead: any, solarData: any, lead_id: string) {
  const settings = await getUserSettings();
  const weights = settings?.scoring_weights ?? undefined;

  // --- Mindestflächen-Check: unter 500m² → Lead löschen ---
  const area = solarData?.max_array_area_m2 ?? null;
  if (area !== null && area < MIN_ROOF_AREA_M2) {
    await supabase
      .from("solar_lead_mass")
      .delete()
      .eq("id", lead_id);

    console.log(`[Solar] Lead ${lead_id} disqualifiziert: Dachfläche ${area}m² < ${MIN_ROOF_AREA_M2}m²`);

    return NextResponse.json({
      disqualified: true,
      reason: "area_too_small",
      area_m2: Math.round(area),
      min_area_m2: MIN_ROOF_AREA_M2,
      message: `Dachfläche zu klein (${Math.round(area)} m²). GreenScout benötigt mindestens ${MIN_ROOF_AREA_M2} m².`,
    });
  }

  // Fetch enrichment data if it exists
  const { data: enrichmentData } = await supabase
    .from("lead_enrichment")
    .select("detected_keywords, enrichment_score")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const scoring = calculateScore(
    {
      category: lead.category,
      solarData: {
        solar_quality: solarData.solar_quality,
        max_array_panels_count: solarData.max_array_panels_count,
        max_array_area_m2: solarData.max_array_area_m2,
        annual_energy_kwh: solarData.annual_energy_kwh,
      },
      enrichmentData: enrichmentData || undefined,
      hasWebsite: !!lead.website,
      hasPhone: !!lead.phone,
      hasEmail: !!lead.email,
    },
    weights
  );

  // Update lead scores
  const { error: scoreUpdateError } = await supabase
    .from("solar_lead_mass")
    .update({
      business_score: scoring.business_score,
      electricity_score: scoring.electricity_score,
      outreach_score: scoring.outreach_score,
      solar_score: scoring.solar_score,
      total_score: scoring.total_score,
    })
    .eq("id", lead_id);

  if (scoreUpdateError) {
    console.error("[Solar] Score update failed for lead", lead_id, scoreUpdateError.message);
  }

  return NextResponse.json({
    assessment: solarData,
    cached: solarData.provider?.includes("cached") ?? false,
    scores: {
      business_score: scoring.business_score,
      electricity_score: scoring.electricity_score,
      outreach_score: scoring.outreach_score,
      solar_score: scoring.solar_score,
      total_score: scoring.total_score,
    },
  });
}
