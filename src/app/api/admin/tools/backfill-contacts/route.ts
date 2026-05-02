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
 * Returns total count of solar_lead_mass leads with a website (= processable).
 * Uses two small queries instead of a large .in() to avoid URL length limits.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Count total leads with a website
  const { count: total } = await adminSupabase
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("website", "is", null)
    .neq("website", "");

  // Count leads that already have at least one contact (distinct lead_ids)
  // Use a small page-by-page approach to avoid huge IN queries
  const { count: withContacts } = await adminSupabase
    .from("lead_contacts")
    .select("lead_id", { count: "exact", head: true });

  // "missing" is approximate — exact number shown during processing
  const missing = Math.max(0, (total ?? 0) - (withContacts ?? 0));

  return NextResponse.json({ missing, total: total ?? 0 });
}

/**
 * POST /api/admin/tools/backfill-contacts
 *
 * Offset-based pagination — advances linearly through all leads.
 * Each call fetches a small PAGE of leads starting at `offset`,
 * skips leads that already have contacts (fast DB check), and runs
 * the 4-stage pipeline for those that don't.
 *
 * This prevents re-processing the same "unfindable" leads on every call.
 * The frontend increments offset using the returned `nextOffset`.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { offset?: number; limit?: number };
  const offset = body.offset ?? 0;
  // 5 leads per batch: conservative to stay within Vercel function timeout
  const batchSize = Math.min(body.limit ?? 5, 5);

  const adminSupabase = createAdminClient();

  // Fetch a small page of leads starting at offset
  const { data: page, error } = await adminSupabase
    .from("solar_lead_mass")
    .select("id, user_id, company_name, website, city")
    .not("website", "is", null)
    .neq("website", "")
    .order("total_score", { ascending: false })
    .range(offset, offset + batchSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // No more leads at this offset → done
  if (!page?.length) {
    return NextResponse.json({
      processed: 0, found: 0, skipped: 0,
      remaining: 0, nextOffset: offset,
      done: true,
      message: "Alle Leads wurden verarbeitet.",
    });
  }

  // Check which of these leads already have contacts (small .in() ≤ 5 IDs)
  const pageIds = page.map((l) => l.id as string);
  const { data: existingContacts } = await adminSupabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", pageIds);

  const withContacts = new Set((existingContacts ?? []).map((c) => c.lead_id as string));
  const toProcess = page.filter((l) => !withContacts.has(l.id as string));

  const nextOffset = offset + page.length;
  let processed = 0;
  let found = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const lead of toProcess) {
    const rawWebsite = lead.website as string;
    const domain = rawWebsite
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

        // Write firmographics back
        const updates: Record<string, unknown> = {};
        const company = (r as { company?: { estimated_num_employees?: number; linkedin_url?: string } }).company;
        if (company?.estimated_num_employees) updates.employee_count = company.estimated_num_employees;
        if (company?.linkedin_url) updates.linkedin_url = company.linkedin_url;
        if (Object.keys(updates).length > 0) {
          await adminSupabase.from("solar_lead_mass").update(updates).eq("id", lead.id);
        }
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
          console.error(`[admin/backfill-contacts] Insert failed for ${lead.id}:`, insertError.message);
          errors.push(`${lead.company_name as string}: ${insertError.message}`);
          skipped++;
        } else {
          found++;
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
  }

  // Count how many leads with website remain beyond this offset (approximate)
  const { count: totalWithWebsite } = await adminSupabase
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("website", "is", null)
    .neq("website", "");

  const remaining = Math.max(0, (totalWithWebsite ?? 0) - nextOffset);

  return NextResponse.json({
    processed,
    found,
    skipped,
    remaining,
    nextOffset,
    // done only when there truly are no more leads at higher offsets
    done: page.length < batchSize || remaining === 0,
    errors: errors.slice(0, 5),
    message: `${processed} verarbeitet, ${page.length - toProcess.length} bereits Kontakte, ${found} neu gefunden.`,
  });
}
