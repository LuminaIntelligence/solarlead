/**
 * GET /api/cron/linkedin-pool-autosync
 *
 * Auto-Sync: alle 4 Stunden werden frisch enrichte Leads die eine
 * persönliche LinkedIn-URL haben in den LinkedIn-Outreach-Pool gehoben
 * — ohne dass der Admin den "Pool füllen"-Button klicken muss.
 *
 * SAFETY-FIRST: Wenn gerade eine Discovery-Campaign läuft (status='running'
 * in discovery_campaigns), wird der Sync übersprungen. Wir wollen nicht
 * mit der Campaign um Worker-Ressourcen konkurrieren und schon gar nicht
 * Leads doppelt anfassen während der Enricher noch dabei ist sie zu
 * vervollständigen.
 *
 * Filter (identisch zum "Pool füllen"-Button):
 *   - status != 'existing_solar'
 *   - solar_assessments.max_array_area_m2 > 0
 *   - kein offener LinkedIn-Job (pending/sent) für den Lead
 * Score-Range: 0..100 (alle qualifizierten — User filtert im Kanban)
 *
 * Idempotent: Leads die schon im Pool sind werden nicht doppelt eingefügt.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  if (req.headers.get("x-cron-secret") === expected) return true;
  if (req.nextUrl.searchParams.get("secret") === expected) return true;
  return false;
}

const CHUNK = 200;

async function chunkedIn<T>(
  query: (ids: string[]) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[]
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await query(slice);
    if (error) throw new Error(error.message);
    if (data) out.push(...data);
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createAdminClient();

  // ── Safety: laufende Campaign? Skip wenn ja ─────────────────────────
  const { data: runningCampaigns } = await sb
    .from("discovery_campaigns")
    .select("id, name, status")
    .eq("status", "running");

  if (runningCampaigns && runningCampaigns.length > 0) {
    const names = runningCampaigns.map((c) => c.name ?? c.id).join(", ");
    console.log(
      `[autosync] SKIP — ${runningCampaigns.length} Campaign(s) laufen: ${names}`
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "campaign_running",
      campaigns: runningCampaigns.length,
      campaign_names: names,
    });
  }

  // Zusätzlich: aktive Enrichment-Jobs prüfen. Wenn Enricher gerade
  // mittendrin ist, lieber später nochmal.
  const { count: enrichingCount } = await sb
    .from("discovery_leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "enriching");

  if (enrichingCount && enrichingCount > 5) {
    console.log(
      `[autosync] SKIP — ${enrichingCount} discovery_leads in enriching`
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "enrichment_active",
      enriching: enrichingCount,
    });
  }

  // ── Pool-Sync ──────────────────────────────────────────────────────
  console.log("[autosync] Start — no campaign running, beginne Pool-Sync");

  // 1) Alle Kontakte mit /in/ LinkedIn-URL (paginiert)
  type Contact = {
    id: string;
    lead_id: string | null;
    name: string | null;
    email: string | null;
    title: string | null;
    linkedin_url: string;
    is_primary: boolean | null;
  };
  const contacts: Contact[] = [];
  let page = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("lead_contacts")
      .select("id, lead_id, name, email, title, linkedin_url, is_primary")
      .ilike("linkedin_url", "%/in/%")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    contacts.push(...(data as Contact[]));
    if (data.length < PAGE) break;
    page++;
  }

  const byLead = new Map<string, Contact[]>();
  for (const c of contacts) {
    if (!c.lead_id) continue;
    if (!byLead.has(c.lead_id)) byLead.set(c.lead_id, []);
    byLead.get(c.lead_id)!.push(c);
  }
  const leadIds = Array.from(byLead.keys());

  if (leadIds.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: false,
      created: 0,
      message: "Keine Kontakte mit /in/ URL gefunden",
    });
  }

  // 2) Leads filtern: NICHT existing_solar
  type LeadRow = {
    id: string;
    company_name: string | null;
    city: string | null;
    category: string | null;
    total_score: number | null;
  };
  const leadRows = await chunkedIn<LeadRow>(
    (slice) =>
      sb
        .from("solar_lead_mass")
        .select("id, company_name, city, category, total_score")
        .in("id", slice)
        .neq("status", "existing_solar") as unknown as Promise<{
        data: LeadRow[] | null;
        error: { message: string } | null;
      }>,
    leadIds
  );

  // 3) MIT Dachfläche
  type RoofRow = { lead_id: string };
  const roofRows = await chunkedIn<RoofRow>(
    (slice) =>
      sb
        .from("solar_assessments")
        .select("lead_id")
        .in("lead_id", slice)
        .gt("max_array_area_m2", 0) as unknown as Promise<{
        data: RoofRow[] | null;
        error: { message: string } | null;
      }>,
    leadRows.map((l) => l.id)
  );
  const leadsWithRoof = new Set(roofRows.map((r) => r.lead_id));
  const ready = leadRows.filter((l) => leadsWithRoof.has(l.id));

  // 4) Schon im Pool? ausschließen
  type ExistingJobRow = { lead_id: string };
  const inPool = await chunkedIn<ExistingJobRow>(
    (slice) =>
      sb
        .from("outreach_jobs")
        .select("lead_id")
        .in("lead_id", slice)
        .eq("channel", "linkedin")
        .in("status", ["pending", "sent"]) as unknown as Promise<{
        data: ExistingJobRow[] | null;
        error: { message: string } | null;
      }>,
    ready.map((l) => l.id)
  );
  const inPoolSet = new Set(inPool.map((j) => j.lead_id));
  const toCreate = ready.filter((l) => !inPoolSet.has(l.id));

  console.log(
    `[autosync] /in/ Kontakte: ${contacts.length} · ` +
      `Unique: ${leadIds.length} · ` +
      `nicht-solar: ${leadRows.length} · ` +
      `mit-Dach: ${ready.length} · ` +
      `im Pool: ${inPoolSet.size} · ` +
      `NEU: ${toCreate.length}`
  );

  if (toCreate.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: false,
      created: 0,
      contacts_with_linkedin: contacts.length,
      unique_leads_with_linkedin: leadIds.length,
      already_in_pool: inPoolSet.size,
      message: "Keine neuen Leads zum Hinzufügen",
    });
  }

  // 5) Admin-User für created_by
  const { data: adminUser } = await sb
    .from("user_settings")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (!adminUser) {
    return NextResponse.json(
      { error: "Kein Admin-User für created_by gefunden" },
      { status: 500 }
    );
  }

  // 6) Batch erstellen
  const dateLabel = new Date().toISOString().slice(0, 10);
  const batchName = `LinkedIn-Pool Auto-Sync ${dateLabel}`;
  const { data: batch, error: bErr } = await sb
    .from("outreach_batches")
    .insert({
      created_by: adminUser.user_id,
      name: batchName,
      description: `Auto-Sync — ${toCreate.length} neue Leads mit LinkedIn-URL.`,
      status: "running",
      daily_limit: 100,
      total_leads: toCreate.length,
      sent_count: 0,
      replied_count: 0,
      template_type: "linkedin",
      followup_enabled: false,
      followup_days: 0,
      followup_template: "linkedin",
      followup_sent_count: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (bErr || !batch) {
    return NextResponse.json(
      { error: `Batch-Erstellung: ${bErr?.message}` },
      { status: 500 }
    );
  }

  // 7) Jobs bauen
  const jobs = toCreate
    .map((lead) => {
      const cs = byLead.get(lead.id) ?? [];
      const best = cs.find((c) => c.is_primary && c.linkedin_url) ?? cs[0];
      if (!best) return null;
      return {
        batch_id: batch.id,
        lead_id: lead.id,
        contact_id: best.id,
        status: "pending" as const,
        channel: "linkedin" as const,
        linkedin_url: best.linkedin_url,
        contact_name: best.name,
        contact_email: best.email,
        contact_title: best.title,
        company_name: lead.company_name,
        company_city: lead.city,
        company_category: lead.category,
        scheduled_for: dateLabel,
        followup_status: "skipped" as const,
      };
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

  let inserted = 0;
  for (let i = 0; i < jobs.length; i += 100) {
    const chunk = jobs.slice(i, i + 100);
    const { error: jErr } = await sb.from("outreach_jobs").insert(chunk);
    if (jErr) {
      console.warn(`[autosync] insert chunk failed: ${jErr.message}`);
    } else {
      inserted += chunk.length;
    }
  }
  await sb
    .from("outreach_batches")
    .update({ total_leads: inserted })
    .eq("id", batch.id);

  // 8) Parallele Email-Jobs für dieselben Leads stornieren
  const createdLeadIds = jobs.map((j) => j.lead_id);
  let emailCancelled = 0;
  for (let i = 0; i < createdLeadIds.length; i += CHUNK) {
    const chunk = createdLeadIds.slice(i, i + CHUNK);
    const { data: c } = await sb
      .from("outreach_jobs")
      .update({ status: "cancelled", followup_status: "skipped" })
      .in("lead_id", chunk)
      .eq("channel", "email")
      .eq("status", "pending")
      .select("id");
    emailCancelled += c?.length ?? 0;
  }

  console.log(
    `[autosync] ✓ ${inserted} neue LinkedIn-Jobs · ` +
      `${emailCancelled} Email-Jobs storniert · Batch ${batch.id}`
  );

  return NextResponse.json({
    ok: true,
    skipped: false,
    created: inserted,
    email_cancelled: emailCancelled,
    batch_id: batch.id,
    batch_name: batchName,
    diagnostics: {
      contacts_with_linkedin: contacts.length,
      unique_leads_with_linkedin: leadIds.length,
      filtered_existing_solar: leadIds.length - leadRows.length,
      filtered_no_roof_area: leadRows.length - ready.length,
      already_in_pool: inPoolSet.size,
    },
  });
}
