import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContactProvider } from "@/lib/providers/contacts";
import { ImpressumScraperProvider } from "@/lib/providers/contacts/impressum";
import { HunterContactProvider } from "@/lib/providers/contacts/hunter";
import { FirecrawlContactProvider } from "@/lib/providers/contacts/firecrawl";
import { recalculateLeadScore } from "@/lib/actions/leads";
import type { Contact } from "@/lib/providers/contacts/types";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * GET /api/admin/tools/backfill-contacts
 *
 * Counts ALL solar_lead_mass leads (across all users) that have a website
 * but no contacts yet in lead_contacts.
 * This covers leads imported via search, CSV, or address-search —
 * not just discovery-pipeline leads.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // All leads with a website (system-wide, all users)
  const { data: leadsWithWebsite } = await adminSupabase
    .from("solar_lead_mass")
    .select("id")
    .not("website", "is", null)
    .neq("website", "");

  if (!leadsWithWebsite?.length) return NextResponse.json({ missing: 0 });

  const allIds = leadsWithWebsite.map((l) => l.id);

  // Which already have at least one contact?
  const { data: existingContacts } = await adminSupabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", allIds);

  const withContacts = new Set((existingContacts ?? []).map((c) => c.lead_id));
  const missing = allIds.filter((id) => !withContacts.has(id)).length;

  return NextResponse.json({ missing });
}

/**
 * POST /api/admin/tools/backfill-contacts
 *
 * Runs the contact pipeline (Apollo → Impressum → Hunter → Firecrawl)
 * for all solar_lead_mass leads that have a website but no contacts yet.
 * Processes system-wide across all users, in batches of 20.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { offset?: number; limit?: number };
  const limit = Math.min(body.limit ?? 20, 20);

  const adminSupabase = createAdminClient();

  // Fetch all leads with websites, ordered by score (highest first)
  const { data: allLeads, error } = await adminSupabase
    .from("solar_lead_mass")
    .select("id, user_id, company_name, website, city")
    .not("website", "is", null)
    .neq("website", "")
    .order("total_score", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!allLeads?.length) {
    return NextResponse.json({ processed: 0, found: 0, remaining: 0, message: "Keine Leads mit Website gefunden." });
  }

  // Find which already have contacts
  const allIds = allLeads.map((l) => l.id);
  const { data: existing } = await adminSupabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", allIds);

  const withContacts = new Set((existing ?? []).map((c) => c.lead_id));
  const pending = allLeads.filter((l) => !withContacts.has(l.id));
  const remaining = pending.length;

  if (remaining === 0) {
    return NextResponse.json({ processed: 0, found: 0, remaining: 0, message: "Alle Leads haben bereits Kontakte." });
  }

  const batch = pending.slice(0, limit);

  let processed = 0;
  let found = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const lead of batch) {
    const domain = (lead.website as string)
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .trim();

    const contactQuery = {
      domain,
      company_name: lead.company_name as string,
      city: (lead.city as string | null) ?? undefined,
    };

    let contacts: Contact[] = [];
    let source = "";

    try {
      // Stage 1: Apollo
      if (process.env.APOLLO_API_KEY && contacts.length === 0) {
        const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
        const r = await apollo.findContacts(contactQuery).catch(() => ({ contacts: [], company: null }));
        const valid = r.contacts.filter((c) => c.email);
        if (valid.length > 0) { contacts = valid; source = "apollo"; }

        // Write firmographics back to lead
        const updates: Record<string, unknown> = {};
        if ((r as { company?: { estimated_num_employees?: number; linkedin_url?: string } }).company?.estimated_num_employees) {
          updates.employee_count = (r as { company: { estimated_num_employees: number } }).company.estimated_num_employees;
        }
        if ((r as { company?: { linkedin_url?: string } }).company?.linkedin_url) {
          updates.linkedin_url = (r as { company: { linkedin_url: string } }).company.linkedin_url;
        }
        if (Object.keys(updates).length > 0) {
          await adminSupabase.from("solar_lead_mass").update(updates).eq("id", lead.id);
        }
      }

      // Stage 2: Impressum-Scraper (free, very good for German companies)
      if (contacts.length === 0) {
        const scraper = new ImpressumScraperProvider();
        const r = await scraper.findContacts(contactQuery).catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email || c.phone);
        if (valid.length > 0) { contacts = valid; source = "impressum"; }
      }

      // Stage 3: Hunter.io
      if (contacts.length === 0 && process.env.HUNTER_API_KEY) {
        const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
        const r = await hunter.findContacts(contactQuery).catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email);
        if (valid.length > 0) { contacts = valid; source = "hunter"; }
      }

      // Stage 4: Firecrawl
      if (contacts.length === 0 && process.env.FIRECRAWL_API_KEY) {
        const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
        const r = await firecrawl.findContacts(contactQuery).catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email || c.phone);
        if (valid.length > 0) { contacts = valid; source = "firecrawl"; }
      }

      if (contacts.length > 0) {
        const { error: insertError } = await adminSupabase.from("lead_contacts").insert(
          contacts.map((c) => ({
            lead_id: lead.id,
            user_id: lead.user_id,
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

        if (insertError) {
          console.error(`[admin/backfill-contacts] Insert failed for lead ${lead.id}:`, insertError.message);
          errors.push(`${lead.company_name as string}: ${insertError.message}`);
          skipped++;
        } else {
          found++;
          // Recalculate outreach_score now that contact data exists
          await recalculateLeadScore(lead.id as string);
        }
      } else {
        skipped++;
      }

      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${lead.company_name as string}: ${msg}`);
      skipped++;
      processed++;
    }

    // Small pause between requests to avoid rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({
    processed,
    found,
    skipped,
    remaining: remaining - processed,
    errors: errors.slice(0, 5),
    message: `${processed} Leads verarbeitet, ${found} Kontakte gefunden, ${skipped} ohne Treffer.`,
  });
}
