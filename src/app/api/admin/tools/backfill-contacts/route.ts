import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContactProvider } from "@/lib/providers/contacts";
import { ImpressumScraperProvider } from "@/lib/providers/contacts/impressum";
import { HunterContactProvider } from "@/lib/providers/contacts/hunter";
import { FirecrawlContactProvider } from "@/lib/providers/contacts/firecrawl";
import type { Contact } from "@/lib/providers/contacts/types";

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/**
 * GET /api/admin/tools/backfill-contacts
 * Preview: how many leads are missing contacts.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // discovery_leads with website, approved/ready status, linked to a lead, no contacts yet.
  // has_contacts IS NULL (never processed) OR has_contacts = false (explicitly set to no contacts).
  const { data: candidates } = await adminSupabase
    .from("discovery_leads")
    .select("lead_id")
    .not("lead_id", "is", null)
    .not("website", "is", null)
    .or("has_contacts.is.null,has_contacts.eq.false")
    .in("status", ["approved", "ready"]);

  return NextResponse.json({ missing: candidates?.length ?? 0 });
}

/**
 * POST /api/admin/tools/backfill-contacts
 *
 * Runs the contact pipeline (Apollo → Impressum → Hunter → Firecrawl)
 * for all discovery_leads that:
 *   - are approved or ready
 *   - have a website
 *   - have NO contacts yet (has_contacts = false)
 *
 * Processes in batches to avoid timeout. Pass { offset: number } to paginate.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { offset?: number; limit?: number };
  const offset = body.offset ?? 0;
  const limit = body.limit ?? 20; // 20 per batch (each lead can take ~10s)

  const adminSupabase = createAdminClient();

  // Fetch candidates: has_contacts IS NULL (never processed) OR explicitly false
  const { data: candidates, error } = await adminSupabase
    .from("discovery_leads")
    .select("id, lead_id, website, company_name, city, user_id, discovery_campaigns(created_by)")
    .not("lead_id", "is", null)
    .not("website", "is", null)
    .or("has_contacts.is.null,has_contacts.eq.false")
    .in("status", ["approved", "ready"])
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!candidates?.length) {
    return NextResponse.json({ processed: 0, found: 0, message: "Keine Leads ohne Kontakte gefunden." });
  }

  let processed = 0;
  let found = 0;
  const errors: string[] = [];

  for (const dl of candidates) {
    const domain = (dl.website as string)
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .trim();

    const campaignRaw = dl.discovery_campaigns;
    const campaign = (Array.isArray(campaignRaw) ? campaignRaw[0] : campaignRaw) as { created_by: string } | null;
    const userId = campaign?.created_by ?? (dl.user_id as string);
    const contactQuery = {
      domain,
      company_name: dl.company_name as string,
      city: (dl.city as string | null) ?? undefined,
    };

    let contacts: Contact[] = [];
    let source = "";

    try {
      // Stage 1: Apollo
      if (process.env.APOLLO_API_KEY && contacts.length === 0) {
        const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
        const r = await apollo.findContacts(contactQuery).catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email);
        if (valid.length > 0) { contacts = valid; source = "apollo"; }
      }

      // Stage 2: Impressum-Scraper
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

      if (contacts.length > 0 && dl.lead_id) {
        const { error: insertError } = await adminSupabase.from("lead_contacts").insert(
          contacts.map((c) => ({
            lead_id: dl.lead_id as string,
            user_id: userId,
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
          console.error(`[backfill-contacts] Insert failed for lead ${dl.lead_id}:`, insertError.message);
          errors.push(`${dl.company_name as string}: DB insert fehlgeschlagen — ${insertError.message}`);
        } else {
          const emailCount = contacts.filter((c) => c.email).length;
          await adminSupabase
            .from("discovery_leads")
            .update({ has_contacts: emailCount > 0, contact_count: emailCount })
            .eq("id", dl.id as string);
          found++;
        }
      }

      processed++;
    } catch (e) {
      errors.push(`${dl.company_name as string}: ${e instanceof Error ? e.message : String(e)}`);
      processed++;
    }
  }

  // Check if more remain (same filter: null or false)
  const { data: remaining } = await adminSupabase
    .from("discovery_leads")
    .select("id", { count: "exact", head: true })
    .not("lead_id", "is", null)
    .not("website", "is", null)
    .or("has_contacts.is.null,has_contacts.eq.false")
    .in("status", ["approved", "ready"]);

  return NextResponse.json({
    processed,
    found,
    remaining: (remaining as unknown as { count: number } | null)?.count ?? 0,
    nextOffset: offset + processed,
    errors: errors.slice(0, 5),
    message: `${processed} Leads verarbeitet, ${found} Kontakte gefunden.`,
  });
}
