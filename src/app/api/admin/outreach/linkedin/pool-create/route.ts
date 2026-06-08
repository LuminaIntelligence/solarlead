/**
 * POST /api/admin/outreach/linkedin/pool-create
 *
 * Erstellt ein virtuelles "LinkedIn-Pool"-Batch + befüllt es mit Outreach-Jobs
 * für ALLE Leads die schon eine persönliche LinkedIn-URL haben. Anschließend
 * tauchen die im LinkedIn-Outreach-Dashboard auf und der Admin kann sie
 * einzeln abarbeiten.
 *
 * Body:
 *   {
 *     min_score?: number,
 *     max_score?: number,
 *     limit?: number,
 *     categories?: string[],     // Filter: nur diese Branchen
 *     city_contains?: string,    // Filter: company_city ILIKE %city%
 *     title_contains?: string,   // Filter: contact_title ILIKE %title%
 *   }
 *
 * Logik:
 *   - Selektiert Leads im Score-Range die einen Kontakt mit linkedin.com/in/
 *     haben
 *   - Skipped Leads die schon einen offenen LinkedIn-Outreach-Job haben
 *     (vermeidet Duplikate)
 *   - Wählt pro Lead den besten Kontakt (is_primary=true bevorzugt)
 *   - Erstellt einen LinkedIn-Outreach-Job pro Lead/Kontakt-Kombination
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
  linkedin_url: string;
  is_primary: boolean | null;
}

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => ({}));
  const minScore = Math.max(0, Math.min(100, Number(body.min_score ?? 0)));
  const maxScore = Math.max(0, Math.min(100, Number(body.max_score ?? 100)));
  const limit = Math.max(1, Math.min(2000, Number(body.limit ?? 500)));
  const categories: string[] = Array.isArray(body.categories)
    ? body.categories.filter((c: unknown) => typeof c === "string")
    : [];
  const cityContains = (body.city_contains as string | undefined)?.trim() || null;
  const titleContains = (body.title_contains as string | undefined)?.trim() || null;

  const sb = createAdminClient();

  // 1) Kontakte mit persönlicher LinkedIn-URL holen, optional nach Title gefiltert
  let contactQuery = sb
    .from("lead_contacts")
    .select("id, lead_id, name, email, title, linkedin_url, is_primary")
    .ilike("linkedin_url", "%/in/%")
    .limit(5000);
  if (titleContains) contactQuery = contactQuery.ilike("title", `%${titleContains}%`);
  const { data: contactsWithLinkedIn, error: cErr } = await contactQuery;
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  if (!contactsWithLinkedIn || contactsWithLinkedIn.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      skipped_no_lead: 0,
      skipped_score: 0,
      skipped_existing_job: 0,
      message: "Keine Kontakte mit persönlicher LinkedIn-URL gefunden",
    });
  }

  // Group nach lead_id (mehrere Kontakte pro Lead möglich)
  const byLead = new Map<string, ContactRow[]>();
  for (const c of contactsWithLinkedIn) {
    if (!c.lead_id) continue;
    if (!byLead.has(c.lead_id)) byLead.set(c.lead_id, []);
    byLead.get(c.lead_id)!.push(c as ContactRow);
  }

  // 2) Lead-Scores holen mit Category-/City-Filter
  // WICHTIG: existing_solar-Leads werden grundsätzlich ausgeschlossen —
  // wir wollen keinen Lead anschreiben dessen Dach bereits Solar hat.
  const leadIds = Array.from(byLead.keys());
  let leadQuery = sb
    .from("solar_lead_mass")
    .select("id, company_name, city, category, total_score")
    .in("id", leadIds)
    .neq("status", "existing_solar")
    .gte("total_score", minScore)
    .lte("total_score", maxScore);
  if (categories.length > 0) leadQuery = leadQuery.in("category", categories);
  if (cityContains) leadQuery = leadQuery.ilike("city", `%${cityContains}%`);
  const { data: leads } = await leadQuery;

  let skippedScore = byLead.size - (leads?.length ?? 0);

  // 3) Existierende OFFENE LinkedIn-Jobs holen (Duplikat-Vermeidung)
  const { data: existingJobs } = await sb
    .from("outreach_jobs")
    .select("lead_id")
    .eq("channel", "linkedin")
    .in("status", ["pending", "sent"])
    .in("lead_id", leadIds);
  const existingLeadIds = new Set((existingJobs ?? []).map((j) => j.lead_id));

  // 4) Batch erstellen
  const dateLabel = new Date().toISOString().slice(0, 10);
  const batchName = `LinkedIn-Pool ${dateLabel} (Score ${minScore}-${maxScore})`;
  const { data: batch, error: batchErr } = await sb
    .from("outreach_batches")
    .insert({
      created_by: gate.user!.id,
      name: batchName,
      description: `Auto-generierter Pool aus ${leads?.length ?? 0} Leads mit persönlicher LinkedIn-URL.`,
      status: "running",
      daily_limit: 100,
      total_leads: leads?.length ?? 0,
      sent_count: 0,
      replied_count: 0,
      template_type: "linkedin",
      followup_enabled: false,
      followup_days: 0,
      followup_template: "linkedin",
      followup_sent_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .select()
    .single();
  if (batchErr || !batch) {
    return NextResponse.json(
      { error: `Batch-Erstellung fehlgeschlagen: ${batchErr?.message}` },
      { status: 500 }
    );
  }

  // 5) Jobs für jeden Lead erstellen — best contact wählen
  let created = 0;
  let skippedExisting = 0;
  const today = new Date().toISOString().slice(0, 10);
  const jobsToInsert: Record<string, unknown>[] = [];

  for (const lead of leads ?? []) {
    if (existingLeadIds.has(lead.id)) {
      skippedExisting++;
      continue;
    }
    const contacts = byLead.get(lead.id as string) ?? [];
    // Beste Kontaktperson: erst is_primary mit LinkedIn, dann erste mit LinkedIn
    const best =
      contacts.find((c) => c.is_primary && c.linkedin_url) ??
      contacts[0];
    if (!best) continue;

    jobsToInsert.push({
      batch_id: batch.id,
      lead_id: lead.id,
      contact_id: best.id,
      status: "pending",
      channel: "linkedin",
      linkedin_url: best.linkedin_url,
      contact_name: best.name,
      contact_email: best.email,
      contact_title: best.title,
      company_name: lead.company_name,
      company_city: lead.city,
      company_category: lead.category,
      scheduled_for: today,
      followup_status: "skipped", // Kein E-Mail-Follow-up für LinkedIn-Jobs
    });
    created++;
    if (created >= limit) break;
  }

  // SAFETY-NET: Direkt vor dem Insert nochmal prüfen ob in der Zwischenzeit
  // (z.B. durch parallelen OSM-Cron) ein Lead auf existing_solar geflippt ist.
  // Verhindert dass solche Leads doch noch in den Pool reinrutschen, falls
  // zwischen dem ersten Filter (Z.94) und dem Insert eine Race Condition liegt.
  const insertLeadIds = jobsToInsert.map((j) => j.lead_id as string);
  let skippedSolarRace = 0;
  if (insertLeadIds.length > 0) {
    const { data: solarRows } = await sb
      .from("solar_lead_mass")
      .select("id")
      .in("id", insertLeadIds)
      .eq("status", "existing_solar");
    const solarSet = new Set((solarRows ?? []).map((r) => r.id as string));
    if (solarSet.size > 0) {
      const before = jobsToInsert.length;
      const filtered = jobsToInsert.filter(
        (j) => !solarSet.has(j.lead_id as string)
      );
      skippedSolarRace = before - filtered.length;
      jobsToInsert.length = 0;
      jobsToInsert.push(...filtered);
      created -= skippedSolarRace;
      console.log(
        `[linkedin/pool-create] Safety-Net: ${skippedSolarRace} existing_solar Leads im letzten Moment rausgefiltert`
      );
    }
  }

  // Batch-Insert in Chunks von 100
  for (let i = 0; i < jobsToInsert.length; i += 100) {
    const chunk = jobsToInsert.slice(i, i + 100);
    const { error: jErr } = await sb.from("outreach_jobs").insert(chunk);
    if (jErr) {
      console.warn("[linkedin/pool-create] Job-Insert-Chunk fehlgeschlagen:", jErr);
    }
  }

  // Total-Count im Batch aktualisieren
  await sb
    .from("outreach_batches")
    .update({ total_leads: created })
    .eq("id", batch.id);

  // Email-Jobs für dieselben Leads stornieren/entschärfen, damit kein
  // Lead parallel via Email UND LinkedIn angeschrieben wird.
  //   - PENDING Email-Jobs → status='cancelled' (raus aus Auto-Send-Queue)
  //   - SENT Email-Jobs    → followup_status='skipped' (kein Follow-up mehr)
  const createdLeadIds = jobsToInsert.map((j) => j.lead_id as string);
  let cancelledPending = 0;
  let stoppedFollowups = 0;
  if (createdLeadIds.length > 0) {
    const { data: cancelledRows } = await sb
      .from("outreach_jobs")
      .update({
        status: "cancelled",
        followup_status: "skipped",
      })
      .eq("channel", "email")
      .eq("status", "pending")
      .in("lead_id", createdLeadIds)
      .select("id");
    cancelledPending = cancelledRows?.length ?? 0;

    const { data: followupStoppedRows } = await sb
      .from("outreach_jobs")
      .update({ followup_status: "skipped" })
      .eq("channel", "email")
      .eq("status", "sent")
      .is("followup_sent_at", null)
      .in("lead_id", createdLeadIds)
      .select("id");
    stoppedFollowups = followupStoppedRows?.length ?? 0;

    console.log(
      `[linkedin/pool-create] Email-Jobs entschärft: ${cancelledPending} pending → cancelled, ${stoppedFollowups} sent → follow-up skipped`
    );
  }

  return NextResponse.json({
    ok: true,
    batch_id: batch.id,
    batch_name: batchName,
    created,
    total_leads_in_range: leads?.length ?? 0,
    skipped_score: skippedScore,
    skipped_existing_job: skippedExisting,
    skipped_solar_race: skippedSolarRace,
    contacts_with_linkedin_total: byLead.size,
    email_pending_cancelled: cancelledPending,
    email_followups_stopped: stoppedFollowups,
  });
}
