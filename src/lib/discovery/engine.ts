/**
 * Discovery Campaign Engine
 * Phase 1: Orchestrates Google Places search across all area × category combinations,
 *           deduplicates, inserts discovery_leads as "pending_enrichment".
 * Phase 2: Enrichment is triggered separately per lead (not blocking the discovery loop).
 *
 * This decoupling prevents a slow enrichment from blocking the campaign completion.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { GooglePlacesProvider } from "@/lib/providers/search/googlePlaces";
import { enrichDiscoveryLead } from "./enricher";
import type { DiscoveryCampaignArea } from "@/types/database";

// Delay between Google Places calls to respect rate limits
const PLACES_DELAY_MS = 600;
// Heartbeat: update campaign updated_at every N area/category combinations
const HEARTBEAT_EVERY = 5;

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
    // ── Dedup set 1: place_ids already in this campaign
    const { data: existingDL } = await supabase
      .from("discovery_leads")
      .select("place_id, postal_code, category")
      .eq("campaign_id", campaignId)
      .not("place_id", "is", null);

    const campaignPlaceIds = new Set<string>(
      (existingDL ?? []).map((r: { place_id: string }) => r.place_id).filter(Boolean)
    );

    // ── Dedup set 2: place_ids already in solar_lead_mass (global)
    const { data: existingLeads } = await supabase
      .from("solar_lead_mass")
      .select("place_id")
      .not("place_id", "is", null);

    const globalPlaceIds = new Set<string>(
      (existingLeads ?? []).map((r: { place_id: string }) => r.place_id).filter(Boolean)
    );

    // ── Dedup set 3: PLZ + category already processed
    const processedPlzCats = new Set<string>(
      (existingDL ?? [])
        .filter((r: { postal_code: string | null; category: string }) => r.postal_code && r.category)
        .map((r: { postal_code: string; category: string }) => `${r.postal_code}:${r.category}`)
    );

    let totalDiscovered = 0;
    let totalDuplicates = 0;
    let iterationCount = 0;

    // ── Phase 1: Discover all places (fast — no enrichment here) ─────────────
    for (const area of areas) {
      for (const category of categories) {
        iterationCount++;
        const label = area.type === "radius"
          ? `${area.value} (${area.radius_km} km)`
          : area.value;

        // Heartbeat every N iterations so the UI sees progress
        if (iterationCount % HEARTBEAT_EVERY === 0) {
          await supabase
            .from("discovery_campaigns")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", campaignId);
        }

        console.log(`[Engine] Searching: ${label} / ${category}`);

        try {
          let results;
          if (area.type === "radius" && area.lat != null && area.lng != null && area.radius_km != null) {
            results = await placesProvider.searchByCoords(
              area.lat,
              area.lng,
              area.radius_km,
              "DE",
              category,
              campaign.search_keyword ?? undefined,
              3
            );
          } else {
            results = await placesProvider.searchCategoryPaginated(
              area.value,
              "DE",
              category,
              campaign.search_keyword ?? undefined,
              3
            );
          }

          const newLeads = [];

          for (const result of results) {
            const placeId = result.place_id ?? null;

            if (placeId && (globalPlaceIds.has(placeId) || campaignPlaceIds.has(placeId))) {
              totalDuplicates++;
              continue;
            }

            if (result.postal_code) {
              const plzKey = `${result.postal_code}:${category}`;
              if (processedPlzCats.has(plzKey)) {
                totalDuplicates++;
                continue;
              }
            }

            if (placeId) {
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

          for (const lead of newLeads) {
            if (lead.postal_code) {
              processedPlzCats.add(`${lead.postal_code}:${category}`);
            }
          }

          if (newLeads.length > 0) {
            const { data: inserted } = await supabase
              .from("discovery_leads")
              .insert(newLeads)
              .select("id");

            const insertedCount = inserted?.length ?? 0;
            totalDiscovered += insertedCount;

            // Update counter
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

            totalDuplicates = 0;

            // ── Phase 2: Enrich each new lead in background (non-blocking) ──
            // Fire-and-forget with a small stagger to avoid API flood
            const leadsToEnrich = inserted ?? [];
            (async () => {
              for (let i = 0; i < leadsToEnrich.length; i++) {
                try {
                  await enrichDiscoveryLead(leadsToEnrich[i].id);
                } catch (e) {
                  console.warn(`[Engine] Enrichment failed for ${leadsToEnrich[i].id}:`, e);
                }
                // Stagger: 2s between enrichments to avoid API flood
                if (i < leadsToEnrich.length - 1) {
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
            })();
          }
        } catch (searchErr) {
          console.error(`[Engine] Search failed for ${label}/${category}:`, searchErr);
        }

        await new Promise((r) => setTimeout(r, PLACES_DELAY_MS));
      }
    }

    // ── Phase 1 complete: all places discovered ───────────────────────────────
    await supabase
      .from("discovery_campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`[Engine] Campaign ${campaignId} discovery completed. Discovered: ${totalDiscovered}`);
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
