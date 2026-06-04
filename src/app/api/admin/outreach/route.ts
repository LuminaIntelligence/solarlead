import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";

// GET: list all outreach_batches ordered by created_at desc
export async function GET() {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { supabase } = gate;

    const { data: batches, error } = await supabase
      .from("outreach_batches")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      // Table may not exist yet — return helpful message
      if (
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation")
      ) {
        return NextResponse.json({
          batches: [],
          warning:
            "Die Tabellen für den Massenversand wurden noch nicht in der Datenbank erstellt. Bitte führe die Migrations-SQL aus.",
        });
      }
      console.error("Fehler beim Abrufen der Batches:", error.message);
      return NextResponse.json(
        { error: "Batches konnten nicht abgerufen werden" },
        { status: 500 }
      );
    }

    return NextResponse.json({ batches: batches ?? [] });
  } catch (err) {
    console.error("Outreach GET fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

// POST: create a new batch with jobs
export async function POST(request: NextRequest) {
  try {
    const gate = await requireAdminAndOrigin(request);
    if (gate.error) return gate.error;
    const { user, supabase } = gate;

    const body = await request.json();
    const {
      name,
      description,
      daily_limit,
      lead_ids: leadIdsInput,
      contact_map,
      template_type,
      followup_enabled = false,
      followup_days = 7,
      followup_template = "followup",
    }: {
      name: string;
      description?: string;
      daily_limit: number;
      lead_ids: string[];
      contact_map: Record<string, { name: string; email: string; title: string }>;
      template_type?: string;
      followup_enabled?: boolean;
      followup_days?: number;
      followup_template?: string;
    } = body;

    if (!name || !leadIdsInput || leadIdsInput.length === 0) {
      return NextResponse.json(
        { error: "Name und Lead-IDs sind erforderlich" },
        { status: 400 }
      );
    }

    // Pre-Filter 1: Leads mit Status 'existing_solar' (Dach hat schon eine
    // PV-Anlage) → aus jedem Outreach-Batch ausschließen, egal welcher Channel.
    const { data: existingSolarRows } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .in("id", leadIdsInput)
      .eq("status", "existing_solar");
    const existingSolarSet = new Set(
      (existingSolarRows ?? []).map((r) => r.id as string)
    );
    const skippedExistingSolarCount = existingSolarSet.size;
    let workingLeadIds = leadIdsInput.filter((id) => !existingSolarSet.has(id));

    // Pre-Filter 2: Leads die schon einen OFFENEN LinkedIn-Outreach-Job
    // (pending oder sent) haben → aus diesem Email-Batch ausschließen.
    // Verhindert doppelte Ansprache (Email + LinkedIn parallel).
    const { data: linkedInActive } = await supabase
      .from("outreach_jobs")
      .select("lead_id")
      .eq("channel", "linkedin")
      .in("status", ["pending", "sent"])
      .in("lead_id", workingLeadIds);
    const linkedInLeadSet = new Set(
      (linkedInActive ?? []).map((j) => j.lead_id as string)
    );
    const skippedLinkedInCount = workingLeadIds.filter((id) =>
      linkedInLeadSet.has(id)
    ).length;
    const lead_ids: string[] = workingLeadIds.filter(
      (id) => !linkedInLeadSet.has(id)
    );

    if (lead_ids.length === 0) {
      return NextResponse.json(
        {
          error: `Alle ${leadIdsInput.length} Leads ausgeschlossen (${skippedExistingSolarCount} bereits Solar, ${skippedLinkedInCount} in LinkedIn-Pipeline) — kein Email-Batch erstellt.`,
          skipped_existing_solar: skippedExistingSolarCount,
          skipped_in_linkedin_pipeline: skippedLinkedInCount,
        },
        { status: 400 }
      );
    }

    // Insert the batch
    const { data: batch, error: batchError } = await supabase
      .from("outreach_batches")
      .insert({
        created_by: user.id,
        name,
        description: description ?? null,
        status: "draft",
        daily_limit: daily_limit ?? 100,
        total_leads: lead_ids.length,
        sent_count: 0,
        replied_count: 0,
        template_type: template_type ?? "erstkontakt",
        followup_enabled,
        followup_days,
        followup_template,
        followup_sent_count: 0,
        started_at: null,
        completed_at: null,
      })
      .select()
      .single();

    if (batchError) {
      if (
        batchError.code === "42P01" ||
        batchError.message?.includes("does not exist")
      ) {
        return NextResponse.json(
          {
            error:
              "Die Datenbanktabellen für den Massenversand existieren noch nicht. Bitte führe zuerst die Migrations-SQL aus.",
          },
          { status: 503 }
        );
      }
      console.error("Fehler beim Erstellen des Batches:", batchError.message);
      return NextResponse.json(
        { error: "Batch konnte nicht erstellt werden" },
        { status: 500 }
      );
    }

    // Fetch lead details from solar_lead_mass for enriching jobs.
    // linkedin_url auf solar_lead_mass ist meistens die Company-URL — die
    // brauchen wir nur als Fallback. Die persönlichen Profile (für InMail)
    // hängen an lead_contacts (siehe unten).
    const { data: leads, error: leadsError } = await supabase
      .from("solar_lead_mass")
      .select("id, company_name, city, category, linkedin_url")
      .in("id", lead_ids);

    if (leadsError) {
      console.error("Fehler beim Abrufen der Lead-Daten:", leadsError.message);
    }

    // Persönliche LinkedIn-URLs aus lead_contacts holen, gematcht über
    // die im contact_map ausgewählte E-Mail. Daher: Lead-ID + Kontakt-Email
    // → linkedin_url des PERSONS-Profils, nicht des Firmen-Profils.
    // Wenn die Person eine LinkedIn-URL hat, geht der Job in die LinkedIn-
    // Pipeline (channel='linkedin'), sonst E-Mail.
    const contactEmails = Object.values(contact_map)
      .map((c) => c?.email)
      .filter((e): e is string => !!e);
    const contactLinkedInMap: Record<string, string | null> = {}; // key = `${lead_id}|${email_lower}`
    if (contactEmails.length > 0) {
      const { data: contacts } = await supabase
        .from("lead_contacts")
        .select("lead_id, email, linkedin_url")
        .in("lead_id", lead_ids)
        .in("email", contactEmails);
      for (const c of contacts ?? []) {
        if (c.lead_id && c.email) {
          contactLinkedInMap[`${c.lead_id}|${c.email.toLowerCase()}`] =
            c.linkedin_url ?? null;
        }
      }
    }

    // Fetch solar assessments (roof area) for lease estimate personalization
    const { data: solarAssessments } = await supabase
      .from("solar_assessments")
      .select("lead_id, max_array_area_m2")
      .in("lead_id", lead_ids)
      .order("created_at", { ascending: false });

    const solarMap: Record<string, number | null> = {};
    for (const sa of solarAssessments ?? []) {
      if (!(sa.lead_id in solarMap)) {
        solarMap[sa.lead_id] = sa.max_array_area_m2 ?? null;
      }
    }

    const leadMap: Record<
      string,
      { company_name: string; city: string; category: string; linkedin_url: string | null }
    > = {};
    for (const lead of leads ?? []) {
      leadMap[lead.id] = {
        company_name: lead.company_name,
        city: lead.city,
        category: lead.category,
        linkedin_url: lead.linkedin_url ?? null,
      };
    }

    // Schedule jobs: first daily_limit get today, next batch tomorrow, etc.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const jobs = lead_ids.map((leadId, index) => {
      const dayOffset = Math.floor(index / (daily_limit ?? 100));
      const scheduledDate = new Date(today);
      scheduledDate.setDate(scheduledDate.getDate() + dayOffset);

      // Pre-schedule follow-up if enabled
      const followupDate = followup_enabled
        ? new Date(scheduledDate.getTime() + followup_days * 24 * 60 * 60 * 1000)
        : null;

      const contact = contact_map[leadId] ?? null;
      const leadInfo = leadMap[leadId] ?? null;

      // Channel-Routing: persönliche LinkedIn-URL des gewählten Kontakts
      // hat Vorrang (für InMail). Fallback: Company-URL (nur als
      // Display-Info, eigentlich kein InMail-Ziel). Sonst E-Mail.
      const personalLinkedIn = contact?.email
        ? contactLinkedInMap[`${leadId}|${contact.email.toLowerCase()}`] ?? null
        : null;
      const linkedInForJob = personalLinkedIn ?? leadInfo?.linkedin_url ?? null;
      // Nur 'echte' persönliche LinkedIn-URLs routen auf LinkedIn-Pipeline.
      // Company-URLs (`/company/...`) sind kein InMail-Ziel → Email-Channel.
      const isPersonalLinkedIn =
        !!linkedInForJob && /linkedin\.com\/in\//i.test(linkedInForJob);
      const channel: "email" | "linkedin" = isPersonalLinkedIn ? "linkedin" : "email";

      return {
        batch_id: batch.id,
        lead_id: leadId,
        contact_id: null,
        status: "pending" as const,
        channel,
        linkedin_url: linkedInForJob,
        contact_name: contact?.name ?? null,
        contact_email: contact?.email ?? null,
        contact_title: contact?.title ?? null,
        company_name: leadInfo?.company_name ?? null,
        company_city: leadInfo?.city ?? null,
        company_category: leadInfo?.category ?? null,
        roof_area_m2: solarMap[leadId] ?? null,
        personalized_subject: null,
        personalized_body: null,
        sent_at: null,
        opened_at: null,
        replied_at: null,
        reply_content: null,
        assigned_to: null,
        scheduled_for: scheduledDate.toISOString().slice(0, 10),
        // Follow-ups gibt's nur für Email — LinkedIn-Follow-up macht der
        // Specialist manuell, sobald die InMail beantwortet wurde.
        followup_scheduled_for:
          channel === "email" && followupDate
            ? followupDate.toISOString().slice(0, 10)
            : null,
        followup_sent_at: null,
        followup_status:
          channel === "email" ? ("pending" as const) : ("skipped" as const),
      };
    });

    // Insert jobs in batches of 100 to avoid request size limits
    const chunkSize = 100;
    for (let i = 0; i < jobs.length; i += chunkSize) {
      const chunk = jobs.slice(i, i + chunkSize);
      const { error: jobsError } = await supabase
        .from("outreach_jobs")
        .insert(chunk);

      if (jobsError) {
        console.error("Fehler beim Erstellen der Jobs:", jobsError.message);
        // Don't fail the whole request — batch was created
      }
    }

    return NextResponse.json(
      {
        batch,
        skipped_existing_solar: skippedExistingSolarCount,
        skipped_in_linkedin_pipeline: skippedLinkedInCount,
        total_requested: leadIdsInput.length,
        total_created: lead_ids.length,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Outreach POST fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
