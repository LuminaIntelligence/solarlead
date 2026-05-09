/**
 * Test-Mode Seed-Logik.
 *
 * Erstellt einen kompletten Test-Run:
 *   - 1 outreach_batch in 'draft'
 *   - N leads (default 30) mit Test-Marker
 *   - N solar_assessments
 *   - N outreach_jobs in 'pending' status
 *   - 2 Reply-Specialists (idempotent — bei Re-Seed werden sie nicht
 *     dupliziert sondern wieder verwendet)
 *
 * ALLE Records bekommen is_test_data=true → Reset löscht sie sauber.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { generateTestLeads, type FakeLead } from "./fake-data";

const TEST_SPECIALIST_EMAILS = [
  "alpha-specialist1@lumina-intelligence.ai",
  "alpha-specialist2@lumina-intelligence.ai",
] as const;

const TEST_SPECIALIST_PASSWORD = "GreenScout2025!";

export interface SeedResult {
  batchId: string;
  batchName: string;
  leadsCreated: number;
  jobsCreated: number;
  specialistEmails: string[];
  specialistPassword: string;
  testLeads: Array<{
    index: number;
    email: string;
    company: string;
    contact: string;
  }>;
}

/**
 * Stellt sicher dass die 2 Test-Specialists existieren und role='reply_specialist' haben.
 * Idempotent: existierende User werden gefunden und nur ihre Rolle geupdatet.
 */
async function ensureTestSpecialists(
  sb: ReturnType<typeof createAdminClient>
): Promise<string[]> {
  const ids: string[] = [];

  for (const email of TEST_SPECIALIST_EMAILS) {
    // 1. User per Auth-Admin-API erstellen oder vorhandenen finden
    let userId: string | null = null;

    // Versuch: erstellen
    const { data: createData, error: createErr } = await sb.auth.admin.createUser({
      email,
      password: TEST_SPECIALIST_PASSWORD,
      email_confirm: true,
      user_metadata: { is_test_user: true },
    });

    if (createData?.user) {
      userId = createData.user.id;
    } else if (createErr?.message?.includes("already")) {
      // Existiert schon — über List-Users finden
      const { data: listData } = await sb.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === email);
      if (existing) {
        userId = existing.id;
        // Passwort resetten falls geändert
        await sb.auth.admin.updateUserById(userId, {
          password: TEST_SPECIALIST_PASSWORD,
        });
      }
    } else if (createErr) {
      throw new Error(`Specialist create fehlgeschlagen für ${email}: ${createErr.message}`);
    }

    if (!userId) {
      throw new Error(`Specialist konnte nicht angelegt/gefunden werden: ${email}`);
    }

    // 2. user_settings: role='reply_specialist', alert_email leer, is_test_data=true
    await sb.from("user_settings").upsert(
      {
        user_id: userId,
        role: "reply_specialist",
        is_test_data: true,
      },
      { onConflict: "user_id" }
    );

    ids.push(userId);
  }

  return ids;
}

export async function runTestSeed(count = 30): Promise<SeedResult> {
  const sb = createAdminClient();

  // 1) Test-Specialists sicherstellen
  await ensureTestSpecialists(sb);

  // 2) Outreach-Batch anlegen
  const batchName = `[TEST] Outreach Test ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const { data: batch, error: batchErr } = await sb
    .from("outreach_batches")
    .insert({
      name: batchName,
      status: "draft",
      is_test_data: true,
    })
    .select()
    .single();

  if (batchErr || !batch) {
    throw new Error(`Batch-Insert fehlgeschlagen: ${batchErr?.message}`);
  }

  const batchId = batch.id as string;
  const fakeLeads: FakeLead[] = generateTestLeads(count);

  // 3) Leads + solar_assessments + outreach_jobs in einem Rutsch
  let leadsCreated = 0;
  let jobsCreated = 0;
  const summary: SeedResult["testLeads"] = [];

  for (const fake of fakeLeads) {
    // Lead in solar_lead_mass (NICHT leads — outreach_jobs.lead_id zeigt auf solar_lead_mass).
    // Felder gemappt aus fake-data + dem solar_lead_mass-Schema:
    //   company_name, category, address, city, postal_code, latitude, longitude,
    //   email (für Inbound-Match-Fallback), status, is_pool_lead=true, is_test_data=true
    const postalCodeMatch = fake.address.match(/(\d{5})\s/);
    const postalCode = postalCodeMatch?.[1] ?? null;

    const { data: lead, error: leadErr } = await sb
      .from("solar_lead_mass")
      .insert({
        company_name: fake.companyName,
        category: fake.companyCategory,
        address: fake.address,
        city: fake.companyCity,
        postal_code: postalCode,
        country: "DE",
        latitude: fake.lat,
        longitude: fake.lng,
        email: fake.contactEmail,
        // source: ENUM-Spalte, "test_seed" wirft 22P02. Wir nutzen
        // 'google_places' (einziger bekannter Wert) — das verfälscht das
        // Test-Verhalten nicht, weil is_test_data=true die Records eh
        // klar als Test markiert.
        source: "google_places",
        status: "new",
        is_pool_lead: true,
        is_test_data: true,
      })
      .select("id")
      .single();

    if (leadErr || !lead) {
      console.warn(`[Seed] solar_lead_mass-Insert fehlgeschlagen für ${fake.companyName}:`, leadErr);
      continue;
    }
    leadsCreated++;

    // Solar Assessment
    await sb.from("solar_assessments").insert({
      lead_id: lead.id,
      provider: "test_seed",
      latitude: fake.lat,
      longitude: fake.lng,
      solar_quality: "good",
      max_array_panels_count: fake.maxArrayPanelsCount,
      max_array_area_m2: fake.roofAreaM2,
      annual_energy_kwh: fake.annualEnergyKwh,
      sunshine_hours: 1700,
      is_test_data: true,
    });

    // Outreach-Job
    const { error: jobErr } = await sb.from("outreach_jobs").insert({
      batch_id: batchId,
      lead_id: lead.id,
      status: "pending",
      contact_name: fake.contactName,
      contact_email: fake.contactEmail,
      contact_title: fake.contactTitle,
      company_name: fake.companyName,
      company_city: fake.companyCity,
      company_category: fake.companyCategory,
      roof_area_m2: fake.roofAreaM2,
      scheduled_for: new Date().toISOString().slice(0, 10),
      followup_status: "pending",
      is_test_data: true,
    });

    if (jobErr) {
      console.warn(`[Seed] Job-Insert fehlgeschlagen für ${fake.companyName}:`, jobErr);
      continue;
    }
    jobsCreated++;
    summary.push({
      index: fake.index,
      email: fake.contactEmail,
      company: fake.companyName,
      contact: fake.contactName,
    });
  }

  return {
    batchId,
    batchName,
    leadsCreated,
    jobsCreated,
    specialistEmails: [...TEST_SPECIALIST_EMAILS],
    specialistPassword: TEST_SPECIALIST_PASSWORD,
    testLeads: summary,
  };
}

/**
 * Löscht entweder einen einzelnen Test-Run (per batchId) oder ALLES mit
 * is_test_data=true (wenn batchId nicht gesetzt).
 */
export async function runTestReset(batchId?: string | null): Promise<{
  deleted: Record<string, number>;
}> {
  const sb = createAdminClient();
  const deleted: Record<string, number> = {};

  // Wenn batchId gesetzt: nur Records dieser Batch löschen
  // Wenn nicht: alle is_test_data=true
  if (batchId) {
    // Lead-IDs der Jobs in diesem Batch sammeln (für solar_assessments + leads cleanup)
    const { data: jobs } = await sb
      .from("outreach_jobs")
      .select("id, lead_id")
      .eq("batch_id", batchId);
    const leadIds = (jobs ?? []).map((j) => j.lead_id).filter(Boolean) as string[];

    // outreach_activities (FK auf outreach_jobs)
    if (jobs && jobs.length > 0) {
      const jobIds = jobs.map((j) => j.id);
      const { count } = await sb
        .from("outreach_activities")
        .delete({ count: "exact" })
        .in("job_id", jobIds);
      deleted.outreach_activities = count ?? 0;
    }

    // outreach_jobs
    {
      const { count } = await sb
        .from("outreach_jobs")
        .delete({ count: "exact" })
        .eq("batch_id", batchId);
      deleted.outreach_jobs = count ?? 0;
    }

    // solar_assessments
    if (leadIds.length > 0) {
      const { count } = await sb
        .from("solar_assessments")
        .delete({ count: "exact" })
        .in("lead_id", leadIds)
        .eq("is_test_data", true);
      deleted.solar_assessments = count ?? 0;
    }

    // solar_lead_mass (das ist die Lead-Tabelle für outreach_jobs)
    if (leadIds.length > 0) {
      const { count } = await sb
        .from("solar_lead_mass")
        .delete({ count: "exact" })
        .in("id", leadIds)
        .eq("is_test_data", true);
      deleted.solar_lead_mass = count ?? 0;
    }

    // outreach_batches
    {
      const { count } = await sb
        .from("outreach_batches")
        .delete({ count: "exact" })
        .eq("id", batchId);
      deleted.outreach_batches = count ?? 0;
    }
  } else {
    // Vollreset
    deleted.outreach_activities =
      (await sb.from("outreach_activities").delete({ count: "exact" }).eq("is_test_data", true)).count ?? 0;
    deleted.outreach_jobs =
      (await sb.from("outreach_jobs").delete({ count: "exact" }).eq("is_test_data", true)).count ?? 0;
    deleted.solar_assessments =
      (await sb.from("solar_assessments").delete({ count: "exact" }).eq("is_test_data", true)).count ?? 0;
    deleted.solar_lead_mass =
      (await sb.from("solar_lead_mass").delete({ count: "exact" }).eq("is_test_data", true)).count ?? 0;
    deleted.outreach_batches =
      (await sb.from("outreach_batches").delete({ count: "exact" }).eq("is_test_data", true)).count ?? 0;
  }

  // Optional: Test-Specialists löschen NUR bei Voll-Reset, nicht bei einzelnem Run.
  // Bei einzelnem Run lassen wir sie stehen — der nächste Run benutzt sie.
  if (!batchId) {
    let removed = 0;
    const { data: list } = await sb.auth.admin.listUsers();
    for (const u of list?.users ?? []) {
      if (u.email && TEST_SPECIALIST_EMAILS.includes(u.email as typeof TEST_SPECIALIST_EMAILS[number])) {
        await sb.auth.admin.deleteUser(u.id);
        removed++;
      }
    }
    deleted.test_specialists = removed;
  }

  return { deleted };
}
