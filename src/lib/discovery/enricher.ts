/**
 * Discovery Lead Enricher
 * Runs Solar + Apollo enrichment for a single discovery_lead row,
 * creates a provisional solar_lead_mass entry, and updates the discovery_lead with results.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getSolarProvider } from "@/lib/providers/solar";
import { getContactProvider } from "@/lib/providers/contacts";
import { ImpressumScraperProvider } from "@/lib/providers/contacts/impressum";
import { calculateScore } from "@/lib/scoring";

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

          // Save solar assessment
          await supabase.from("solar_assessments").insert({
            lead_id: leadId,
            provider: "google_solar",
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
      const contactProvider = getContactProvider(
        "live",
        process.env.APOLLO_API_KEY
      );
      try {
        const contactResult = await contactProvider.findContacts({
          domain,
          company_name: dl.company_name,
          city: dl.city,
        });

        const validContacts = contactResult.contacts.filter((c) => c.email);
        contactCount = validContacts.length;
        hasContacts = contactCount > 0;

        // Save contacts
        if (validContacts.length > 0) {
          await supabase.from("lead_contacts").insert(
            validContacts.map((c) => ({
              lead_id: leadId,
              user_id: campaign.created_by,
              name: c.name,
              title: c.title,
              email: c.email,
              phone: c.phone,
              linkedin_url: c.linkedin_url,
              apollo_id: c.apollo_id,
              seniority: c.seniority,
              department: c.department,
              source: "apollo",
            }))
          );
        }
      } catch (e) {
        console.warn("[Enricher] Apollo contacts failed:", e);
      }
    }

    // 5b. Impressum-Scraper as fallback if Apollo found nothing
    if (!hasContacts && domain) {
      try {
        const scraper = new ImpressumScraperProvider();
        const scraperResult = await scraper.findContacts({
          domain,
          company_name: dl.company_name,
          city: dl.city ?? undefined,
        });

        const validContacts = scraperResult.contacts.filter((c) => c.email);
        if (validContacts.length > 0) {
          contactCount = validContacts.length;
          hasContacts = true;

          await supabase.from("lead_contacts").insert(
            validContacts.map((c) => ({
              lead_id: leadId,
              user_id: campaign.created_by,
              name: c.name,
              title: c.title,
              email: c.email,
              phone: c.phone,
              linkedin_url: null,
              apollo_id: null,
              seniority: c.seniority,
              department: null,
              source: "impressum",
            }))
          );

          console.log(
            `[Enricher] Impressum-Scraper hat ${validContacts.length} Kontakt(e) für ${domain} gefunden`
          );
        }
      } catch (e) {
        console.warn("[Enricher] Impressum-Scraper failed:", e);
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
