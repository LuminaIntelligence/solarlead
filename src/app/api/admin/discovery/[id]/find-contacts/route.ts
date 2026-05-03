/**
 * POST /api/admin/discovery/[id]/find-contacts
 *
 * Re-runs contact enrichment for a single discovery_lead.
 * Pipeline: Apollo → Hunter → Impressum-Scraper → Firecrawl
 * Returns detailed debug info about which sources were tried.
 *
 * Body: { lead_id: string }  — the discovery_lead.id (not the solar_lead_mass.id)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ImpressumScraperProvider, type ScraperDebugLog } from "@/lib/providers/contacts/impressum";
import { HunterContactProvider } from "@/lib/providers/contacts/hunter";
import { FirecrawlContactProvider } from "@/lib/providers/contacts/firecrawl";
import { getContactProvider } from "@/lib/providers/contacts";
import type { Contact } from "@/lib/providers/contacts/types";

import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

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
      debug: { tried_urls: [], found_on_url: null, emails_raw: [], phones_raw: [], error: "Keine Website" },
    });
  }

  const campaign = dl.discovery_campaigns as { created_by: string };
  const contactQuery = { domain, company_name: dl.company_name, city: dl.city ?? undefined };
  const debugLog: ScraperDebugLog = { tried_urls: [], found_on_url: null, emails_raw: [], phones_raw: [] };

  let contacts: Contact[] = [];
  let source = "";

  // ── Stage 1: Apollo ────────────────────────────────────────────────────────
  if (process.env.APOLLO_API_KEY) {
    try {
      const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
      const result = await apollo.findContacts(contactQuery);
      const valid = result.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "apollo"; }
    } catch (e) { console.warn("[FindContacts] Apollo failed:", e); }
  }

  // ── Stage 2: Impressum-Scraper ─────────────────────────────────────────────
  if (contacts.length === 0) {
    try {
      const scraper = new ImpressumScraperProvider();
      const result = await scraper.findContacts(contactQuery, debugLog);
      const valid = result.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "impressum"; }
    } catch (e) { console.warn("[FindContacts] Impressum-Scraper failed:", e); }
  }

  // ── Stage 3: Hunter.io ─────────────────────────────────────────────────────
  if (contacts.length === 0 && process.env.HUNTER_API_KEY) {
    try {
      const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
      const result = await hunter.findContacts(contactQuery);
      const valid = result.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "hunter"; }
    } catch (e) { console.warn("[FindContacts] Hunter failed:", e); }
  }

  // ── Stage 4: Firecrawl (JS-Rendering) ──────────────────────────────────────
  if (contacts.length === 0 && process.env.FIRECRAWL_API_KEY) {
    try {
      const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
      const result = await firecrawl.findContacts(contactQuery);
      const valid = result.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "firecrawl"; }
    } catch (e) { console.warn("[FindContacts] Firecrawl failed:", e); }
  }

  if (contacts.length === 0) {
    return NextResponse.json({
      found: 0,
      message: `Keine Kontakte gefunden (Apollo → Hunter → Impressum → Firecrawl). ${debugLog.tried_urls.length} URLs geprüft.`,
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
  const emailCount = contacts.filter((c) => c.email).length;
  await adminSupabase
    .from("discovery_leads")
    .update({
      has_contacts: emailCount > 0,
      contact_count: emailCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead_id);

  return NextResponse.json({
    found: savedCount,
    source,
    emails: contacts.map((c) => c.email).filter(Boolean),
    phones: contacts.map((c) => c.phone).filter(Boolean),
    message: `${savedCount} Kontakt(e) gefunden via ${source}.`,
    debug: debugLog,
  });
}
