import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getContactProvider } from "@/lib/providers/contacts";
import { ImpressumScraperProvider } from "@/lib/providers/contacts/impressum";
import { HunterContactProvider } from "@/lib/providers/contacts/hunter";
import { FirecrawlContactProvider } from "@/lib/providers/contacts/firecrawl";
import type { Contact } from "@/lib/providers/contacts/types";

function extractDomain(input: string): string {
  try {
    const url = input.includes("://") ? input : `https://${input}`;
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return input.replace(/^www\./, "").split("/")[0];
  }
}

/**
 * GET /api/dashboard/contacts/backfill
 * Returns count of the current user's leads that have no contacts yet and have a website.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Leads with a website but no contacts yet
  const { data: leads } = await supabase
    .from("solar_lead_mass")
    .select("id")
    .eq("user_id", user.id)
    .not("website", "is", null)
    .neq("website", "");

  if (!leads || leads.length === 0) return NextResponse.json({ pending: 0 });

  const leadIds = leads.map((l) => l.id);

  // Which of those already have at least one contact?
  const { data: existingContacts } = await supabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", leadIds)
    .eq("user_id", user.id);

  const withContacts = new Set((existingContacts ?? []).map((c) => c.lead_id));
  const pending = leadIds.filter((id) => !withContacts.has(id)).length;

  return NextResponse.json({ pending });
}

/**
 * POST /api/dashboard/contacts/backfill
 * Processes up to `limit` leads (default 10) that have no contacts yet.
 * Returns { processed, found, skipped, remaining } for progress polling.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { limit?: number };
  const batchSize = Math.min(body.limit ?? 10, 20);

  // Fetch leads with website
  const { data: allLeads } = await supabase
    .from("solar_lead_mass")
    .select("id, company_name, website, city")
    .eq("user_id", user.id)
    .not("website", "is", null)
    .neq("website", "")
    .order("total_score", { ascending: false });

  if (!allLeads || allLeads.length === 0) {
    return NextResponse.json({ processed: 0, found: 0, skipped: 0, remaining: 0 });
  }

  // Find which already have contacts
  const allIds = allLeads.map((l) => l.id);
  const { data: existing } = await supabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", allIds)
    .eq("user_id", user.id);

  const withContacts = new Set((existing ?? []).map((c) => c.lead_id));
  const pending = allLeads.filter((l) => !withContacts.has(l.id));
  const remaining = pending.length;

  if (remaining === 0) {
    return NextResponse.json({ processed: 0, found: 0, skipped: 0, remaining: 0 });
  }

  const batch = pending.slice(0, batchSize);

  let processed = 0;
  let found = 0;
  let skipped = 0;

  for (const lead of batch) {
    const domain = extractDomain(lead.website!);
    const contactQuery = {
      domain,
      company_name: lead.company_name,
      city: lead.city ?? undefined,
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

        // Firmographics aus Apollo zurückschreiben
        const updates: Record<string, unknown> = {};
        if (r.company?.estimated_num_employees) updates.employee_count = r.company.estimated_num_employees;
        if (r.company?.linkedin_url) updates.linkedin_url = r.company.linkedin_url;
        if (Object.keys(updates).length > 0) {
          await supabase.from("solar_lead_mass").update(updates).eq("id", lead.id).eq("user_id", user.id);
        }
      }

      // Stage 2: Impressum-Scraper (kostenlos, sehr gut für deutsche Unternehmen)
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
        const { error: insertError } = await supabase.from("lead_contacts").insert(
          contacts.map((c) => ({
            lead_id: lead.id,
            user_id: user.id,
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
          console.error(`[backfill-contacts] Insert failed for lead ${lead.id}:`, insertError.message);
          skipped++;
        } else {
          found++;
        }
      } else {
        skipped++;
      }

      processed++;
    } catch (err) {
      console.error(`[backfill-contacts] Lead ${lead.id} failed:`, err);
      skipped++;
      processed++;
    }

    // Kurze Pause zwischen Anfragen
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({
    processed,
    found,
    skipped,
    remaining: remaining - processed,
  });
}
