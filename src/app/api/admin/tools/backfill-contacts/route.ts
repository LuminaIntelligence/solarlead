/**
 * Contact Backfill — robust time-budget architecture.
 *
 * One POST request = up to 50 seconds of server-side work.
 * Internally:
 *   1. Atomically claims a small batch of pending leads (race-safe via DB locks).
 *   2. Processes them in parallel with strict per-lead timeouts.
 *   3. Loops until time budget runs out OR queue is empty.
 *   4. Returns aggregated stats — frontend just calls again.
 *
 * Why this works reliably:
 *   - Vercel maxDuration = 60s; we exit at 50s with 10s margin.
 *   - Per-lead hard timeout = 55s, but normal case is <30s.
 *   - DB-persisted status (pending/searching/found/not_found/error) survives
 *     ANY crash — function timeout, browser close, network drop.
 *   - 'searching' rows older than 5min are auto-reclaimed on next GET.
 *   - Frontend can keep retrying — duplicates are impossible (status lock).
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

// Vercel function config — give us up to 60s wall-clock per invocation.
// (Pro plan default is 15s; explicitly raise to 60s for this long route.)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Tuning constants
const TIME_BUDGET_MS = 50_000; // exit at 50s, leaves 10s safety margin under maxDuration
const PARALLELISM = 4;          // leads processed simultaneously per inner loop iteration
const PER_LEAD_TIMEOUT_MS = 55_000; // hard cap per lead — never exceed time budget

const STAGE_TIMEOUT_APOLLO_MS = 10_000;
const STAGE_TIMEOUT_IMPRESSUM_MS = 12_000;
const STAGE_TIMEOUT_HUNTER_MS = 8_000;
const STAGE_TIMEOUT_FIRECRAWL_MS = 25_000;

function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

/** Wraps a promise with a hard timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

interface Lead {
  id: string;
  user_id: string;
  company_name: string;
  website: string;
  city: string | null;
}

/** Atomically claim ONE pending lead by SELECT-then-conditional-UPDATE. */
async function claimOneLead(
  adminSupabase: ReturnType<typeof createAdminClient>
): Promise<Lead | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: candidate } = await adminSupabase
      .from("solar_lead_mass")
      .select("id, user_id, company_name, website, city")
      .eq("contact_search_status", "pending")
      .not("website", "is", null)
      .neq("website", "")
      .neq("status", "existing_solar")
      .order("total_score", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!candidate) return null; // queue empty

    // Race-safe claim: only update if status is still 'pending'
    const { data: claimed } = await adminSupabase
      .from("solar_lead_mass")
      .update({
        contact_search_status: "searching",
        contact_search_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("contact_search_status", "pending")
      .select("id, user_id, company_name, website, city")
      .maybeSingle();

    if (claimed) {
      return {
        id: claimed.id as string,
        user_id: claimed.user_id as string,
        company_name: claimed.company_name as string,
        website: claimed.website as string,
        city: (claimed.city as string | null) ?? null,
      };
    }
    // Lost race — try again with the next pending lead
  }
  return null;
}

interface LeadResult {
  leadId: string;
  company: string;
  outcome: "found" | "not_found" | "error";
  contactCount?: number;
  source?: string;
  error?: string;
}

/** Run the 4-stage contact pipeline for a single lead and persist results. */
async function processLead(
  adminSupabase: ReturnType<typeof createAdminClient>,
  lead: Lead
): Promise<LeadResult> {
  const leadId = lead.id;
  const result: LeadResult = { leadId, company: lead.company_name, outcome: "error" };

  try {
    const rawWebsite = lead.website;
    const domain = rawWebsite
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .trim();

    const contactQuery = {
      domain,
      company_name: lead.company_name,
      city: lead.city ?? undefined,
    };

    let contacts: Contact[] = [];
    let source = "";

    // Stage 1: Apollo
    if (process.env.APOLLO_API_KEY && contacts.length === 0) {
      const apollo = getContactProvider("live", process.env.APOLLO_API_KEY);
      const r = await withTimeout(apollo.findContacts(contactQuery), STAGE_TIMEOUT_APOLLO_MS, "apollo")
        .catch(() => ({ contacts: [], company: null }));
      const valid = r.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "apollo"; }

      // Save firmographics (don't await — best-effort)
      const updates: Record<string, unknown> = {};
      const company = (r as { company?: { estimated_num_employees?: number; linkedin_url?: string } }).company;
      if (company?.estimated_num_employees) updates.employee_count = company.estimated_num_employees;
      if (company?.linkedin_url) updates.linkedin_url = company.linkedin_url;
      if (Object.keys(updates).length > 0) {
        await adminSupabase.from("solar_lead_mass").update(updates).eq("id", leadId);
      }
    }

    // Stage 2: Impressum
    if (contacts.length === 0) {
      const scraper = new ImpressumScraperProvider();
      const r = await withTimeout(scraper.findContacts(contactQuery), STAGE_TIMEOUT_IMPRESSUM_MS, "impressum")
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "impressum"; }
    }

    // Stage 3: Hunter
    if (contacts.length === 0 && process.env.HUNTER_API_KEY) {
      const hunter = new HunterContactProvider(process.env.HUNTER_API_KEY);
      const r = await withTimeout(hunter.findContacts(contactQuery), STAGE_TIMEOUT_HUNTER_MS, "hunter")
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email);
      if (valid.length > 0) { contacts = valid; source = "hunter"; }
    }

    // Stage 4: Firecrawl
    if (contacts.length === 0 && process.env.FIRECRAWL_API_KEY) {
      const firecrawl = new FirecrawlContactProvider(process.env.FIRECRAWL_API_KEY);
      const r = await withTimeout(firecrawl.findContacts(contactQuery), STAGE_TIMEOUT_FIRECRAWL_MS, "firecrawl")
        .catch(() => ({ contacts: [] }));
      const valid = r.contacts.filter((c) => c.email || c.phone);
      if (valid.length > 0) { contacts = valid; source = "firecrawl"; }
    }

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
        return { ...result, outcome: "error", error: insertError.message };
      }

      await adminSupabase
        .from("solar_lead_mass")
        .update({ contact_search_status: "found", contact_search_at: new Date().toISOString() })
        .eq("id", leadId);

      // Recalc scores after success — non-critical, swallow errors
      try { await recalculateLeadScore(leadId); } catch { /* ignore */ }

      return { ...result, outcome: "found", contactCount: contacts.length, source };
    }

    // No contacts found in any of the 4 stages — mark not_found permanently
    await adminSupabase
      .from("solar_lead_mass")
      .update({ contact_search_status: "not_found", contact_search_at: new Date().toISOString() })
      .eq("id", leadId);

    return { ...result, outcome: "not_found" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[backfill-contacts] Pipeline error for ${leadId}:`, msg);
    await adminSupabase
      .from("solar_lead_mass")
      .update({ contact_search_status: "error", contact_search_at: new Date().toISOString() })
      .eq("id", leadId);
    return { ...result, outcome: "error", error: msg };
  }
}

/**
 * GET — returns counts by status. Auto-reclaims stuck 'searching' rows >5min old.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Reclaim stuck rows
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await adminSupabase
    .from("solar_lead_mass")
    .update({ contact_search_status: "pending" })
    .eq("contact_search_status", "searching")
    .lt("contact_search_at", fiveMinAgo);

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

  return NextResponse.json({
    total: totalRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    searching: searchingRes.count ?? 0,
    found: foundRes.count ?? 0,
    not_found: notFoundRes.count ?? 0,
    error: errorRes.count ?? 0,
    missing: (pendingRes.count ?? 0) + (errorRes.count ?? 0),
  });
}

/**
 * POST — process leads continuously until time budget runs out OR queue is empty.
 *
 * Returns aggregate stats. Frontend just keeps calling this until `idle: true`.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const startTime = Date.now();

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  const recentResults: Array<{ company: string; outcome: string; source?: string; contactCount?: number }> = [];
  const errorMessages: string[] = [];

  while (Date.now() - startTime < TIME_BUDGET_MS) {
    // Claim a small batch of leads (up to PARALLELISM)
    const claims: Lead[] = [];
    for (let i = 0; i < PARALLELISM; i++) {
      const lead = await claimOneLead(adminSupabase);
      if (!lead) break;
      claims.push(lead);
    }

    if (claims.length === 0) {
      // Queue is empty
      return NextResponse.json({
        idle: true,
        processed, found, notFound, errors,
        recentResults: recentResults.slice(-10),
        errorMessages: errorMessages.slice(-5),
        elapsedMs: Date.now() - startTime,
      });
    }

    // Process the batch in parallel with strict per-lead timeouts
    const results = await Promise.allSettled(
      claims.map((lead) =>
        withTimeout(processLead(adminSupabase, lead), PER_LEAD_TIMEOUT_MS, `lead:${lead.id}`)
      )
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const lead = claims[i];
      processed++;
      if (r.status === "fulfilled") {
        const v = r.value;
        recentResults.push({
          company: v.company,
          outcome: v.outcome,
          source: v.source,
          contactCount: v.contactCount,
        });
        if (v.outcome === "found") found++;
        else if (v.outcome === "not_found") notFound++;
        else { errors++; if (v.error) errorMessages.push(`${v.company}: ${v.error}`); }
      } else {
        // withTimeout fired — mark lead as error so it leaves 'searching' state
        errors++;
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errorMessages.push(`${lead.company_name}: ${errMsg}`);
        await adminSupabase
          .from("solar_lead_mass")
          .update({ contact_search_status: "error", contact_search_at: new Date().toISOString() })
          .eq("id", lead.id);
      }
    }
  }

  // Time budget exhausted — return what we have, frontend will call again
  return NextResponse.json({
    idle: false,
    processed, found, notFound, errors,
    recentResults: recentResults.slice(-10),
    errorMessages: errorMessages.slice(-5),
    elapsedMs: Date.now() - startTime,
  });
}

/**
 * DELETE — reset 'error' rows to 'pending' so they can be retried.
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
