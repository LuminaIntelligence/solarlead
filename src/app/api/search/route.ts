import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSearchProvider } from "@/lib/providers/search";
import { saveSearchRun, saveLead, saveLeads } from "@/lib/actions/leads";
import { getUserSettings } from "@/lib/actions/settings";
import { calculateScore } from "@/lib/scoring";
import type { SearchResult } from "@/lib/providers/search/types";
import type { Lead } from "@/types/database";

const SearchQuerySchema = z.object({
  country: z.string().min(1),
  city: z.string().min(1),
  radius_km: z.number().min(1).max(200),
  categories: z.array(z.string()).min(1),
  keywords: z.string().optional(),
});

// POST: Execute a search
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
    const parsed = SearchQuerySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid search query", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const query = parsed.data;

    // Get user settings — fall back to system (admin) settings if user has no live key
    const settings = await getUserSettings();
    let mode = settings?.provider_mode ?? "mock";
    let apiKey = settings?.google_places_api_key ?? undefined;

    if (mode !== "live" || !apiKey) {
      // Try to find any admin/system settings with a live Google Places key
      const adminClient = createAdminClient();
      const { data: systemSettings } = await adminClient
        .from("user_settings")
        .select("provider_mode, google_places_api_key")
        .eq("provider_mode", "live")
        .not("google_places_api_key", "is", null)
        .limit(1)
        .maybeSingle();

      if (systemSettings?.google_places_api_key) {
        mode = "live";
        apiKey = systemSettings.google_places_api_key;
      }
    }

    // Create search provider and execute search
    const provider = getSearchProvider(mode, apiKey);
    const results = await provider.search(query);

    // Save search run record
    await saveSearchRun(
      `${query.city}, ${query.country}`,
      {
        country: query.country,
        city: query.city,
        radius_km: query.radius_km,
        categories: query.categories,
        keywords: query.keywords,
      },
      results.length
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Save search results to the leads pipeline
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const results: SearchResult[] = body.results;

    if (!results || !Array.isArray(results) || results.length === 0) {
      return NextResponse.json(
        { error: "No results to save" },
        { status: 400 }
      );
    }

    const settings = await getUserSettings();
    const weights = settings?.scoring_weights ?? undefined;

    // Calculate initial scores and map to lead format
    const leadsToSave: Omit<Lead, "id" | "created_at" | "updated_at" | "user_id">[] = results.map(
      (result) => {
        const scoring = calculateScore(
          {
            category: result.category,
            hasWebsite: !!result.website,
            hasPhone: !!result.phone,
            hasEmail: false,
          },
          weights
        );

        return {
          company_name: result.company_name,
          category: result.category,
          website: result.website,
          phone: result.phone,
          email: null,
          address: result.address,
          city: result.city,
          postal_code: result.postal_code,
          country: result.country,
          latitude: result.latitude,
          longitude: result.longitude,
          place_id: result.place_id,
          source: "google_places" as const,
          business_score: scoring.business_score,
          electricity_score: scoring.electricity_score,
          outreach_score: scoring.outreach_score,
          solar_score: scoring.solar_score,
          total_score: scoring.total_score,
          status: "new" as const,
          notes: null,
          linkedin_url: null,
        };
      }
    );

    if (leadsToSave.length === 1) {
      const saved = await saveLead(leadsToSave[0]);
      return NextResponse.json({
        savedLeads: saved ? [saved] : [],
        count: saved ? 1 : 0,
      });
    }

    // Bulk save - saveLeads returns count but not the actual objects
    // We need the IDs, so we insert and retrieve
    const count = await saveLeads(leadsToSave);

    if (count === 0) {
      return NextResponse.json({ savedLeads: [], count: 0 });
    }

    // Retrieve recently saved leads to get their IDs
    const placeIds = results
      .map((r) => r.place_id)
      .filter((id): id is string => id !== null);

    let savedLeads: Lead[] = [];
    if (placeIds.length > 0) {
      const { data } = await supabase
        .from("solar_lead_mass")
        .select("*")
        .in("place_id", placeIds)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(results.length);

      savedLeads = (data as Lead[]) || [];
    } else {
      // Fallback: fetch by company names
      const names = results.map((r) => r.company_name);
      const { data } = await supabase
        .from("solar_lead_mass")
        .select("*")
        .in("company_name", names)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(results.length);

      savedLeads = (data as Lead[]) || [];
    }

    return NextResponse.json({ savedLeads, count });
  } catch (error) {
    console.error("Save leads API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
