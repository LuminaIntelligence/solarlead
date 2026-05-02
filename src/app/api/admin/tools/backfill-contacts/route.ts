/**
 * Contact backfill — single-lead pick-and-lock architecture.
 *
 * Each POST request:
 *   1. Atomically picks the next 'pending' lead and marks it 'searching' (DB lock).
 *   2. Runs the 4-stage pipeline (Apollo → Impressum → Hunter → Firecrawl) with timeouts.
 *   3. Marks the lead 'found' / 'not_found' / 'error' based on outcome.
 *   4. Returns immediately so the next request can pick another lead.
 *
 * The frontend keeps N concurrent requests in flight at all times — true parallelism
 * via DB locking, no risk of duplicates, fully resumable across page reloads.
 *
 * Stuck 'searching' rows (Vercel timeout, browser crash) are auto-reclaimed if older
 * than 5 minutes via the GET endpoint's reset query.
 */
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

/** Wraps a promise with a hard timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * GET — returns counts by status. Also reclaims stuck 'searching' rows older than 5min.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Reclaim stuck rows (status=searching but no progress in 5 min)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await adminSupabase
    .from("solar_lead_mass")
    .update({ contact_search_status: "pending" })
    .eq("contact_search_status", "searching")
    .lt("contact_search_at", fiveMinAgo);

  // Count each status (only leads with website, not existing_solar)
  const baseQuery = () =>
    adminSupabase
      .from("solar_lead_mass")
      .select("id", { count: "exact", head: true })
      .not("website", "is", null)
      .neq("website", "")
      .neq("status", "existing_solar");

  const [pendingRes, searchingRes, foundRes, notFoundRes, errorRes, totalRes] = await Promise.all([
    baseQuery().eq("contact_search_status", "pending"),
    baseQuery().eq("contact_search_status", "searching"),
    baseQuery().eq("contact_search_status", "found"),
    baseQuery().eq("contact_search_status", "not_found"),
    baseQuery().eq("contact_search_status", "error"),
    baseQuery(),
  ]);

  const pending = pendingRes.count ?? 0;
  const searching = searchingRes.count ?? 0;
  const found = foundRes.count ?? 0;
  const not_found = notFoundRes.count ?? 0;
  const error_count = errorRes.count ?? 0;
  const total = totalRes.count ?? 0;

  return NextResponse.json({
    total,
    pending,
    searching,
    found,
    not_found,
    error: error_count,
    // "missing" = pending + error (work still to do)
    missing: pending + error_count,
  });
}

/**
 * POST — atomically pick next pending lead, process, mark final status.
 * Returns { result: 'found' | 'not_found' | 'error' | 'idle', leadId?, ... }
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Step 1: SELECT the next pending lead (highest score first).
  // Step 2: Conditionally UPDATE it to 'searching' — only succeeds if still pending
  //          (race-safe: another worker that picked the same row will get 0 rows).
  // Step 3: If UPDATE returns 0 rows, retry up to 3 times (race with parallel workers).
  let lead: { id: string; user_id: string; company_name: string; website: string; city: string | null } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: candidate, error: selectError } = await adminSupabase
      .from("solar_lead_mass")
      .select("id, user_id, company_name, website, city")
      .eq("contact_search_status", "pending")
      .not("website", "is", null)
      .neq("website", "")
      .neq("status", "existing_solar")
      .order("total_score", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      return NextResponse.json({ error: `select: ${selectError.message}` }, { status: 500 });
    }

    if (!candidate) {
      return NextResponse.json({ result: "idle", message: "Keine Leads in der Warteschlange." });
    }

    // Conditional claim — only updates if status is still 'pending'
    const { data: claimed, error: updateError } = await adminSupabase
      .from("solar_lead_mass")
      .update({
        contact_search_status: "searching",
        contact_search_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("contact_search_status", "pending")
      .select("id, user_id, company_name, website, city")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: `claim: ${updateError.message}` }, { status: 500 });
    }

    if (claimed) {
      lead = {
        id: claimed.id as string,
        user_id: claimed.user_id as string,
        company_name: claimed.company_name as string,
        website: claimed.website as string,
        city: (claimed.city as string | null) ?? null,
      };
      break;
    }
    // Lost the race — another worker grabbed it. Loop tries the next pending lead.
  }

  if (!lead) {
    // Couldn't claim anything after 3 attempts (high contention or empty queue)
    return NextResponse.json({ result: "idle", message: "Keine Leads claim-bar." });
  }

  const leadId = lead.id;

  try {
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

    // Stage 1: Apollo (15s)
    if (process.env.APOLLO_API_KEY && contacts.length === 0) {
      const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
      const r = await withTimeout(apollo.findContacts(contactQuery), 15_000)
        .catch(() => ({ contacts: [], company: null }));
      const valid = r.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "apollo"; }

      // Save firmographics
      const updates: Record<string, unknown> = {};
      const company = (r as { company?: { estimated_num_employees?: number; linkedin_url?: string } }).company;
      if (company?.estimated_num_employees) updates.employee_count = company.estimated_num_employees;
      if (company?.linkedin_url) updates.linkedin_url = company.linkedin_url;
      if (Object.keys(updates).length > 0) {
        await adminSupabase.from("solar_lead_mass").update(updates).eq("id", leadId);
      }
    }

    // Stage 2: Impressum (20s)
    if (contacts.length === 0) {
      const scraper = new ImpressumScraperProvider();
      const r = await withTimeout(scraper.findContacts(contactQuery), 20_000)
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "impressum"; }
    }

    // Stage 3: Hunter (15s)
    if (contacts.length === 0 && process.env.HUNTER_API_KEY) {
      const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
      const r = await withTimeout(hunter.findContacts(contactQuery), 15_000)
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "hunter"; }
    }

    // Stage 4: Firecrawl (45s)
    if (contacts.length === 0 && process.env.FIRECRAWL_API_KEY) {
      const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
      const r = await withTimeout(firecrawl.findContacts(contactQuery), 45_000)
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "firecrawl"; }
    }

    // Persist result
    if (contacts.length > 0) {
      const { error: insertError } = await adminSupabase.from("lead_contacts").insert(
        contacts.map((c) => ({
          lead_id: leadId,
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
        console.error(`[backfill-contacts] Insert failed for ${leadId}:`, insertError.message);
        await adminSupabase
          .from("solar_lead_mass")
          .update({ contact_search_status: "error", contact_search_at: new Date().toISOString() })
          .eq("id", leadId);
        return NextResponse.json({
          result: "error", leadId, company: lead.company_name,
          error: insertError.message,
        });
      }

      await adminSupabase
        .from("solar_lead_mass")
        .update({ contact_search_status: "found", contact_search_at: new Date().toISOString() })
        .eq("id", leadId);

      // Recalc scores after success
      try { await recalculateLeadScore(leadId); } catch { /* non-critical */ }

      return NextResponse.json({
        result: "found", leadId, company: lead.company_name,
        contactCount: contacts.length, source,
      });
    } else {
      // All 4 stages ran, nothing found — mark not_found so we don't retry
      await adminSupabase
        .from("solar_lead_mass")
        .update({ contact_search_status: "not_found", contact_search_at: new Date().toISOString() })
        .eq("id", leadId);

      return NextResponse.json({
        result: "not_found", leadId, company: lead.company_name,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[backfill-contacts] Pipeline error for ${leadId}:`, msg);
    await adminSupabase
      .from("solar_lead_mass")
      .update({ contact_search_status: "error", contact_search_at: new Date().toISOString() })
      .eq("id", leadId);
    return NextResponse.json({
      result: "error", leadId, company: lead.company_name, error: msg,
    });
  }
}

/**
 * DELETE — reset 'error' rows back to 'pending' so they can be retried.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { error, count } = await adminSupabase
    .from("solar_lead_mass")
    .update({ contact_search_status: "pending" }, { count: "exact" })
    .eq("contact_search_status", "error");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reset: count ?? 0 });
}
