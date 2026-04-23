/**
 * Discovery Campaign Engine
 * Orchestrates Google Places search across all area × category combinations,
 * deduplicates against existing leads, and triggers enrichment per discovered lead.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { GooglePlacesProvider } from "@/lib/providers/search/googlePlaces";
import { enrichDiscoveryLead } from "./enricher";
import type { DiscoveryCampaignArea } from "@/types/database";

// Delay between Google Places calls to respect rate limits
const PLACES_DELAY_MS = 600;
// Delay between enrichment calls (Solar + Apollo)
const ENRICH_DELAY_MS = 1500;

export async function runDiscoveryCampaign(campaignId: string): Promise<void> {
  const supabase = createAdminClient();

  // Load campaign
  const { data: campaign, error } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !campaign) {
    console.error("[Engine] Campaign not found:", campaignId);
    return;
  }

  // Mark as running
  await supabase
    .from("discovery_campaigns")
    .update({ status: "running", started_at: new Date().toISOString(), error_message: null })
    .eq("id", campaignId);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    await failCampaign(supabase, campaignId, "GOOGLE_PLACES_API_KEY nicht gesetzt");
    return;
  }

  const placesProvider = new GooglePlacesProvider(apiKey);
  const areas: DiscoveryCampaignArea[] = campaign.areas ?? [];
  const categories: string[] = campaign.categories ?? [];

  if (areas.length === 0 || categories.length === 0) {
    await failCampaign(supabase, campaignId, "Keine Gebiete oder Branchen konfiguriert");
    return;
  }

  try {
    // Collect all place_ids already in discovery_leads for this campaign (dedup within campaign)
    const { data: existingDL } = await supabase
      .from("discovery_leads")
      .select("place_id")
      .eq("campaign_id", campaignId)
      .not("place_id", "is", null);

    const campaignPlaceIds = new Set<string>(
      (existingDL ?? []).map((r: { place_id: string }) => r.place_id).filter(Boolean)
    );

    // Collect all place_ids already in solar_lead_mass (global dedup)
    const { data: existingLeads } = await supabase
      .from("solar_lead_mass")
      .select("place_id")
      .not("place_id", "is", null);

    const globalPlaceIds = new Set<string>(
      (existingLeads ?? []).map((r: { place_id: string }) => r.place_id).filter(Boolean)
    );

    let totalDiscovered = 0;
    let totalDuplicates = 0;

    // Iterate area × category
    for (const area of areas) {
      for (const category of categories) {
        const city = area.value;

        console.log(`[Engine] Searching: ${city} / ${category}`);

        try {
          const results = await placesProvider.searchCategoryPaginated(
            city,
            "DE",
            category,
            campaign.search_keyword ?? undefined,
            3 // up to 3 pages = 60 results
          );

          const newLeads = [];

          for (const result of results) {
            const placeId = result.place_id ?? null;

            // Dedup check
            if (placeId) {
              if (globalPlaceIds.has(placeId) || campaignPlaceIds.has(placeId)) {
                totalDuplicates++;
                continue;
              }
              campaignPlaceIds.add(placeId);
              globalPlaceIds.add(placeId);
            }

            newLeads.push({
              campaign_id: campaignId,
              company_name: result.company_name,
              address: result.address ?? "",
              city: result.city,
              postal_code: result.postal_code,
              country: result.country ?? "DE",
              category,
              website: result.website,
              phone: result.phone,
              place_id: placeId,
              latitude: result.latitude,
              longitude: result.longitude,
              status: "pending_enrichment",
            });
          }

          // Batch insert new discovery leads
          if (newLeads.length > 0) {
            const { data: inserted } = await supabase
              .from("discovery_leads")
              .insert(newLeads)
              .select("id");

            const insertedCount = inserted?.length ?? 0;
            totalDiscovered += insertedCount;

            // Update campaign counter
            const { data: camp } = await supabase
              .from("discovery_campaigns")
              .select("total_discovered, total_duplicates")
              .eq("id", campaignId)
              .single();

            await supabase
              .from("discovery_campaigns")
              .update({
                total_discovered: (camp?.total_discovered ?? 0) + insertedCount,
                total_duplicates: (camp?.total_duplicates ?? 0) + totalDuplicates,
                updated_at: new Date().toISOString(),
              })
              .eq("id", campaignId);

            totalDuplicates = 0; // reset for next batch

            // Enrich each new lead
            for (const insertedLead of inserted ?? []) {
              await enrichDiscoveryLead(insertedLead.id);
              await new Promise((r) => setTimeout(r, ENRICH_DELAY_MS));
            }
          }
        } catch (searchErr) {
          console.error(`[Engine] Search failed for ${city}/${category}:`, searchErr);
        }

        // Pause between searches
        await new Promise((r) => setTimeout(r, PLACES_DELAY_MS));
      }
    }

    // Mark completed
    await supabase
      .from("discovery_campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`[Engine] Campaign ${campaignId} completed. Discovered: ${totalDiscovered}`);
  } catch (err) {
    console.error("[Engine] Campaign failed:", err);
    await failCampaign(
      supabase,
      campaignId,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function failCampaign(supabase: any, campaignId: string, message: string): Promise<void> {
  await supabase
    .from("discovery_campaigns")
    .update({
      status: "failed",
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}
