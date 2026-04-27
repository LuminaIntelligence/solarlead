/**
 * Discovery Lead Enricher
 * Runs Solar + Apollo enrichment for a single discovery_lead row,
 * creates a provisional solar_lead_mass entry, and updates the discovery_lead with results.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getSolarProvider } from "@/lib/providers/solar";
import { getContactProvider } from "@/lib/providers/contacts";
import { ImpressumScraperProvider } from "@/lib/providers/contacts/impressum";
import { HunterContactProvider } from "@/lib/providers/contacts/hunter";
import { FirecrawlContactProvider } from "@/lib/providers/contacts/firecrawl";
import type { Contact } from "@/lib/providers/contacts/types";
import { calculateScore } from "@/lib/scoring";
import { checkExistingSolarOsm } from "@/lib/providers/mastr/overpass";

const MIN_ROOF_AREA_M2 = 500;

export async function enrichDiscoveryLead(discoveryLeadId: string): Promise<void> {
  const supabase = createAdminClient();

  // 1. Load discovery lead + campaign
  const { data: dl, error: dlError } = await supabase
    .from("discovery_leads")
    .select("*, discovery_campaigns(auto_approve_threshold, created_by)")
    .eq("id", discoveryLeadId)
    .single();

  if (dlError || !dl) {
    console.error("[Enricher] Discovery lead not found:", discoveryLeadId);
    return;
  }

  // Mark as enriching
  await supabase
    .from("discovery_leads")
    .update({ status: "enriching", updated_at: new Date().toISOString() })
    .eq("id", discoveryLeadId);

  try {
    const campaign = dl.discovery_campaigns as { auto_approve_threshold: number | null; created_by: string };

    // 2. Create provisional solar_lead_mass row
    const { data: leadRow, error: insertErr } = await supabase
      .from("solar_lead_mass")
      .insert({
        user_id: campaign.created_by,
        company_name: dl.company_name,
        category: dl.category,
        address: dl.address,
        city: dl.city,
        postal_code: dl.postal_code,
        country: dl.country ?? "DE",
        latitude: dl.latitude,
        longitude: dl.longitude,
        place_id: dl.place_id,
        website: dl.website,
        phone: dl.phone,
        source: "google_places",
        status: "new",
        is_pool_lead: true,
        business_score: 0,
        electricity_score: 0,
        solar_score: 0,
        outreach_score: 0,
        total_score: 0,
      })
      .select("id")
      .single();

    if (insertErr || !leadRow) {
      throw new Error(`Failed to create lead row: ${insertErr?.message}`);
    }

    const leadId = leadRow.id;

    // Link discovery_lead → lead
    await supabase
      .from("discovery_leads")
      .update({ lead_id: leadId })
      .eq("id", discoveryLeadId);

    // 2.5. Check for existing rooftop solar via OpenStreetMap (free, no quota)
    //      If detected → mark lead as existing_solar and skip full enrichment
    if (dl.latitude && dl.longitude) {
      try {
        const solarCheck = await checkExistingSolarOsm(dl.latitude, dl.longitude);
        if (solarCheck.hasSolar) {
          await supabase
            .from("solar_lead_mass")
            .update({ status: "existing_solar", updated_at: new Date().toISOString() })
            .eq("id", leadId);
          await supabase
            .from("discovery_leads")
            .update({
              status: "insufficient_data",
              rejection_reason: `Bereits Solar vorhanden (OpenStreetMap, ${solarCheck.count} Einträge)`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", discoveryLeadId);
          await incrementCampaignCounter(supabase, dl.campaign_id, "total_enriched");
          console.log(`[Enricher] Existing solar detected via OSM for ${dl.company_name}`);
          return;
        }
      } catch (e) {
        // Never block enrichment due to OSM check failure
        console.warn("[Enricher] OSM solar check failed (non-fatal):", e);
      }
    }

    // 3. Solar assessment
    let solarResult = null;
    let hasSolarData = false;
    let solarQuality: string | null = null;
    let maxAreaM2: number | null = null;

    if (dl.latitude && dl.longitude) {
      const solarProvider = getSolarProvider(
        "live",
        process.env.GOOGLE_SOLAR_API_KEY
      );
      try {
        solarResult = await solarProvider.assess({
          latitude: dl.latitude,
          longitude: dl.longitude,
          place_id: dl.place_id ?? undefined,
        });

        if (solarResult) {
          hasSolarData = true;
          solarQuality = solarResult.solar_quality;
          maxAreaM2 = solarResult.max_array_area_m2;

          // Save solar assessment — delete any old partial records first to avoid duplicates
          await supabase
            .from("solar_assessments")
            .delete()
            .eq("lead_id", leadId)
            .is("max_array_panels_count", null);

          const { error: solarInsertErr } = await supabase.from("solar_assessments").insert({
            lead_id: leadId,
            provider: "google_solar",
            latitude: dl.latitude,
            longitude: dl.longitude,
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
          if (solarInsertErr) {
            console.warn("[Enricher] solar_assessments insert failed:", solarInsertErr.message);
          }
        }
      } catch (e) {
        console.warn("[Enricher] Solar assessment failed:", e);
      }
    }

    // 4. Check minimum roof area
    if (hasSolarData && maxAreaM2 !== null && maxAreaM2 < MIN_ROOF_AREA_M2) {
      await supabase
        .from("discovery_leads")
        .update({
          status: "insufficient_data",
          has_solar_data: hasSolarData,
          solar_quality: solarQuality,
          max_array_area_m2: maxAreaM2,
          rejection_reason: `Dachfläche zu klein: ${Math.round(maxAreaM2)} m² (Minimum: ${MIN_ROOF_AREA_M2} m²)`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", discoveryLeadId);

      // Remove the provisional lead — not useful
      await supabase.from("solar_lead_mass").delete().eq("id", leadId);

      await incrementCampaignCounter(supabase, dl.campaign_id, "total_enriched");
      return;
    }

    // 5. Apollo contacts
    let hasContacts = false;
    let contactCount = 0;

    const domain = dl.website
      ? dl.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim()
      : null;

    if (domain) {
      // ── Contact pipeline: Apollo → Impressum → Hunter → Firecrawl ──────────
      // Each stage only runs if the previous found nothing.
      const contactQuery = { domain, company_name: dl.company_name, city: dl.city ?? undefined };

      const saveContacts = async (contacts: Contact[], source: string) => {
        const valid = contacts.filter((c) => c.email || c.phone);
        if (valid.length === 0) return false;
        await supabase.from("lead_contacts").insert(
          valid.map((c) => ({
            lead_id: leadId,
            user_id: campaign.created_by,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            linkedin_url: c.linkedin_url ?? null,
            apollo_id: c.apollo_id ?? null,
            seniority: c.seniority,
            department: c.department ?? null,
            source,
          }))
        );
        contactCount = valid.filter((c) => c.email).length;
        hasContacts = valid.filter((c) => c.email).length > 0 || valid.filter((c) => c.phone).length > 0;
        return true;
      };

      // Stage 1: Apollo
      if (process.env.APOLLO_API_KEY) {
        try {
          const apolloProvider = getContactProvider("live", process.env.APOLLO_API_KEY);
          const result = await apolloProvider.findContacts(contactQuery);
          if (await saveContacts(result.contacts, "apollo")) {
            console.log(`[Enricher] Apollo: ${contactCount} Kontakt(e) für ${domain}`);
          }
        } catch (e) { console.warn("[Enricher] Apollo failed:", e); }
      }

      // Stage 2: Impressum-Scraper (kostenlos)
      if (!hasContacts) {
        try {
          const scraper = new ImpressumScraperProvider();
          const result = await scraper.findContacts(contactQuery);
          if (await saveContacts(result.contacts, "impressum")) {
            console.log(`[Enricher] Impressum-Scraper: ${contactCount} Kontakt(e) für ${domain}`);
          }
        } catch (e) { console.warn("[Enricher] Impressum-Scraper failed:", e); }
      }

      // Stage 3: Hunter.io
      if (!hasContacts && process.env.HUNTER_API_KEY) {
        try {
          const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
          const result = await hunter.findContacts(contactQuery);
          if (await saveContacts(result.contacts, "hunter")) {
            console.log(`[Enricher] Hunter: ${contactCount} Kontakt(e) für ${domain}`);
          }
        } catch (e) { console.warn("[Enricher] Hunter failed:", e); }
      }

      // Stage 4: Firecrawl (JS-Rendering, letzter Ausweg)
      if (!hasContacts && process.env.FIRECRAWL_API_KEY) {
        try {
          const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
          const result = await firecrawl.findContacts(contactQuery);
          if (await saveContacts(result.contacts, "firecrawl")) {
            console.log(`[Enricher] Firecrawl: ${contactCount} Kontakt(e) für ${domain}`);
          }
        } catch (e) { console.warn("[Enricher] Firecrawl failed:", e); }
      }
    }

    // 6. Calculate score
    const scoring = calculateScore({
      category: dl.category,
      solarData: solarResult
        ? {
            solar_quality: solarResult.solar_quality,
            max_array_panels_count: solarResult.max_array_panels_count,
            max_array_area_m2: solarResult.max_array_area_m2,
            annual_energy_kwh: solarResult.annual_energy_kwh,
          }
        : null,
      enrichmentData: null,
      hasWebsite: !!dl.website,
      hasPhone: !!dl.phone,
      hasEmail: hasContacts,
    });

    // 7. Update solar_lead_mass with scores
    await supabase
      .from("solar_lead_mass")
      .update({
        business_score: scoring.business_score,
        electricity_score: scoring.electricity_score,
        solar_score: scoring.solar_score,
        outreach_score: scoring.outreach_score,
        total_score: scoring.total_score,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    // 8. Determine discovery_lead status
    const threshold = campaign.auto_approve_threshold;
    const autoApprove = threshold !== null && scoring.total_score >= threshold;
    const newStatus = autoApprove ? "approved" : "ready";

    await supabase
      .from("discovery_leads")
      .update({
        status: newStatus,
        total_score: scoring.total_score,
        has_contacts: hasContacts,
        has_solar_data: hasSolarData,
        contact_count: contactCount,
        solar_quality: solarQuality,
        max_array_area_m2: maxAreaM2,
        approved_at: autoApprove ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", discoveryLeadId);

    // 9. Update campaign counters
    await incrementCampaignCounter(supabase, dl.campaign_id, "total_enriched");
    if (newStatus === "ready" || newStatus === "approved") {
      await incrementCampaignCounter(supabase, dl.campaign_id, "total_ready");
    }
    if (newStatus === "approved") {
      await incrementCampaignCounter(supabase, dl.campaign_id, "total_approved");
    }
  } catch (err) {
    console.error("[Enricher] Enrichment failed:", err);
    await supabase
      .from("discovery_leads")
      .update({
        status: "insufficient_data",
        rejection_reason: `Fehler bei Anreicherung: ${err instanceof Error ? err.message : String(err)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", discoveryLeadId);
  }
}

async function incrementCampaignCounter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  campaignId: string,
  field: string
): Promise<void> {
  const { data } = await supabase
    .from("discovery_campaigns")
    .select(field)
    .eq("id", campaignId)
    .single();
  if (data) {
    await supabase
      .from("discovery_campaigns")
      .update({ [field]: (data[field] ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", campaignId);
  }
}
