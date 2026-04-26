/**
 * POST /api/admin/discovery/[id]/find-contacts
 *
 * Re-runs contact enrichment for a single discovery_lead.
 * Returns detailed debug info about which URLs were tried and what was found.
 *
 * Body: { lead_id: string }  — the discovery_lead.id (not the solar_lead_mass.id)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ImpressumScraperProvider, type ScraperDebugLog } from "@/lib/providers/contacts/impressum";
import { getContactProvider } from "@/lib/providers/contacts";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lead_id } = await req.json() as { lead_id: string };
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 });

  const { id: campaignId } = await params;
  const adminSupabase = createAdminClient();

  // Load discovery_lead
  const { data: dl, error: dlErr } = await adminSupabase
    .from("discovery_leads")
    .select("*, discovery_campaigns(created_by)")
    .eq("id", lead_id)
    .eq("campaign_id", campaignId)
    .single();

  if (dlErr || !dl) {
    return NextResponse.json({ error: "Discovery lead not found" }, { status: 404 });
  }

  const domain = dl.website
    ? dl.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim()
    : null;

  if (!domain) {
    return NextResponse.json({
      found: 0,
      message: "Keine Website für diesen Lead hinterlegt.",
      debug: { tried_urls: [], found_on_url: null, emails_raw: [], error: "Keine Website" },
    });
  }

  const campaign = dl.discovery_campaigns as { created_by: string };
  const debugLog: ScraperDebugLog = { tried_urls: [], found_on_url: null, emails_raw: [] };

  // ── Apollo first (if key exists) ──────────────────────────────────────────
  let contacts: Array<{
    apollo_id: string | null;
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    seniority: string | null;
    department: string | null;
  }> = [];
  let source = "impressum";

  if (process.env.APOLLO_API_KEY) {
    try {
      const apolloProvider = getContactProvider("live", process.env.APOLLO_API_KEY);
      const apolloResult = await apolloProvider.findContacts({
        domain,
        company_name: dl.company_name,
        city: dl.city,
      });
      const valid = apolloResult.contacts.filter((c) => c.email);
      if (valid.length > 0) {
        contacts = valid;
        source = "apollo";
      }
    } catch (e) {
      console.warn("[FindContacts] Apollo failed:", e);
    }
  }

  // ── Impressum scraper if Apollo found nothing ────────────────────────────
  if (contacts.length === 0) {
    const scraper = new ImpressumScraperProvider();
    const result = await scraper.findContacts(
      { domain, company_name: dl.company_name, city: dl.city ?? undefined },
      debugLog
    );
    contacts = result.contacts.filter((c) => c.email);
    source = "impressum";
  }

  if (contacts.length === 0) {
    return NextResponse.json({
      found: 0,
      message: `Keine E-Mails gefunden. ${debugLog.tried_urls.length} URLs geprüft.`,
      debug: debugLog,
    });
  }

  // ── Delete existing contacts for this lead (re-enrich = replace) ──────────
  if (dl.lead_id) {
    await adminSupabase.from("lead_contacts").delete().eq("lead_id", dl.lead_id);
  }

  // ── Save contacts ──────────────────────────────────────────────────────────
  let savedCount = 0;
  if (dl.lead_id) {
    const { data: inserted } = await adminSupabase.from("lead_contacts").insert(
      contacts.map((c) => ({
        lead_id: dl.lead_id,
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
    ).select("id");
    savedCount = inserted?.length ?? contacts.length;
  }

  // ── Update discovery_lead counts ──────────────────────────────────────────
  await adminSupabase
    .from("discovery_leads")
    .update({
      has_contacts: true,
      contact_count: contacts.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead_id);

  return NextResponse.json({
    found: savedCount,
    source,
    emails: contacts.map((c) => c.email),
    message: `${savedCount} Kontakt(e) gefunden und gespeichert (Quelle: ${source}).`,
    debug: debugLog,
  });
}
