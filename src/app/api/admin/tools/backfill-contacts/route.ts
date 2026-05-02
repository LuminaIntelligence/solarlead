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
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Count processable leads: has website, not already marked as existing_solar
  const { count: total } = await adminSupabase
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("website", "is", null)
    .neq("website", "")
    .neq("status", "existing_solar");

  // Count leads that already have contacts — page through to get distinct lead_ids
  // (a single COUNT would double-count leads with multiple contacts)
  const PAGE = 1000;
  const distinctLeadIds = new Set<string>();
  let lcOffset = 0;
  while (true) {
    const { data } = await adminSupabase
      .from("lead_contacts")
      .select("lead_id")
      .range(lcOffset, lcOffset + PAGE - 1);
    if (!data?.length) break;
    for (const row of data) distinctLeadIds.add(row.lead_id as string);
    if (data.length < PAGE) break;
    lcOffset += PAGE;
  }

  const missing = Math.max(0, (total ?? 0) - distinctLeadIds.size);

  return NextResponse.json({ missing, total: total ?? 0 });
}

/**
 * POST /api/admin/tools/backfill-contacts
 *
 * Offset-based pagination — advances linearly through all leads.
 * Leads in each batch are processed IN PARALLEL (Promise.allSettled) to
 * avoid sequential API latency stacking up (Impressum scraper + Firecrawl
 * can each take 5-30s per lead — sequential = batchSize × that).
 *
 * Batch size: 10 leads processed concurrently.
 * Expected time per batch: ~15-30s (slowest lead, not sum of all leads).
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { offset?: number; limit?: number };
  const offset = body.offset ?? 0;
  // 10 leads processed in parallel — faster than sequential while staying within timeout
  const batchSize = Math.min(body.limit ?? 10, 10);

  const adminSupabase = createAdminClient();

  // Fetch a page of leads starting at offset
  // Skip leads already marked as existing_solar — no need to find contacts for them
  const { data: page, error } = await adminSupabase
    .from("solar_lead_mass")
    .select("id, user_id, company_name, website, city")
    .not("website", "is", null)
    .neq("website", "")
    .neq("status", "existing_solar")
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

  // Check which of these leads already have contacts (small .in() ≤ 10 IDs)
  const pageIds = page.map((l) => l.id as string);
  const { data: existingContacts } = await adminSupabase
    .from("lead_contacts")
    .select("lead_id")
    .in("lead_id", pageIds);

  const withContactsSet = new Set((existingContacts ?? []).map((c) => c.lead_id as string));
  const toProcess = page.filter((l) => !withContactsSet.has(l.id as string));

  const nextOffset = offset + page.length;

  /** Wraps a promise with a hard timeout — rejects if not resolved within `ms`. */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      ),
    ]);
  }

  /**
   * Process a single lead through the 4-stage contact pipeline.
   * Returns { found: boolean, error?: string }
   */
  async function processLead(lead: NonNullable<typeof page>[number]): Promise<{ found: boolean; error?: string }> {
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
      // Stage 1: Apollo (15s timeout)
      if (process.env.APOLLO_API_KEY && contacts.length === 0) {
        const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
        const r = await withTimeout(apollo.findContacts(contactQuery), 15_000)
          .catch(() => ({ contacts: [], company: null }));
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

      // Stage 2: Impressum-Scraper (20s timeout)
      if (contacts.length === 0) {
        const scraper = new ImpressumScraperProvider();
        const r = await withTimeout(scraper.findContacts(contactQuery), 20_000)
          .catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email || c.phone);
        if (valid.length > 0) { contacts = valid; source = "impressum"; }
      }

      // Stage 3: Hunter.io (15s timeout)
      if (contacts.length === 0 && process.env.HUNTER_API_KEY) {
        const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
        const r = await withTimeout(hunter.findContacts(contactQuery), 15_000)
          .catch(() => ({ contacts: [] }));
        const valid = r.contacts.filter((c) => c.email);
        if (valid.length > 0) { contacts = valid; source = "hunter"; }
      }

      // Stage 4: Firecrawl (45s timeout — AI-powered, inherently slower)
      if (contacts.length === 0 && process.env.FIRECRAWL_API_KEY) {
        const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
        const r = await withTimeout(firecrawl.findContacts(contactQuery), 45_000)
          .catch(() => ({ contacts: [] }));
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
          return { found: false, error: `${lead.company_name as string}: ${insertError.message}` };
        }

        await recalculateLeadScore(lead.id as string);
        return { found: true };
      }

      return { found: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { found: false, error: `${lead.company_name as string}: ${msg}` };
    }
  }

  // Process all leads in this batch IN PARALLEL — key performance improvement.
  // Sequential: batchSize × avg_lead_time. Parallel: max(lead_times) ≈ same as 1 lead.
  const results = await Promise.allSettled(toProcess.map((lead) => processLead(lead)));

  let processed = 0;
  let found = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const result of results) {
    processed++;
    if (result.status === "fulfilled") {
      if (result.value.found) {
        found++;
      } else {
        skipped++;
        if (result.value.error) errors.push(result.value.error);
      }
    } else {
      skipped++;
      errors.push(String(result.reason));
    }
  }

  // Count how many processable leads remain beyond this offset (approximate)
  const { count: totalWithWebsite } = await adminSupabase
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .not("website", "is", null)
    .neq("website", "")
    .neq("status", "existing_solar");

  const remaining = Math.max(0, (totalWithWebsite ?? 0) - nextOffset);

  return NextResponse.json({
    processed,
    found,
    skipped,
    remaining,
    nextOffset,
    done: page.length < batchSize || remaining === 0,
    errors: errors.slice(0, 5),
    message: `${processed} verarbeitet, ${page.length - toProcess.length} bereits Kontakte, ${found} neu gefunden.`,
  });
}
