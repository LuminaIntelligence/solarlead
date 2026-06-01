/**
 * POST /api/admin/outreach/linkedin/sync-email-jobs
 *
 * Einmaliger / On-Demand Sync für den Bestand:
 *   Für JEDEN Lead der einen offenen LinkedIn-Outreach-Job hat
 *   (pending oder sent), werden parallele Email-Jobs entschärft:
 *     - PENDING Email-Jobs → status='cancelled'
 *     - SENT Email-Jobs    → followup_status='skipped'
 *
 * Idempotent: kann beliebig oft aufgerufen werden.
 * Antwort enthält wie viele Email-Jobs angefasst wurden.
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const sb = createAdminClient();

  // 1) Alle Leads mit offenem LinkedIn-Job sammeln
  const { data: linkedInJobs, error: lErr } = await sb
    .from("outreach_jobs")
    .select("lead_id")
    .eq("channel", "linkedin")
    .in("status", ["pending", "sent"]);
  if (lErr) {
    return NextResponse.json({ error: lErr.message }, { status: 500 });
  }
  const leadIds = Array.from(
    new Set((linkedInJobs ?? []).map((j) => j.lead_id as string).filter(Boolean))
  );

  if (leadIds.length === 0) {
    return NextResponse.json({
      ok: true,
      leads_in_linkedin_pipeline: 0,
      email_pending_cancelled: 0,
      email_followups_stopped: 0,
      message: "Keine Leads in LinkedIn-Pipeline gefunden — nichts zu syncen.",
    });
  }

  // 2) Pending Email-Jobs stornieren
  const { data: cancelledRows, error: cErr } = await sb
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      followup_status: "skipped",
    })
    .eq("channel", "email")
    .eq("status", "pending")
    .in("lead_id", leadIds)
    .select("id, lead_id");
  if (cErr) {
    return NextResponse.json(
      { error: `Cancel-Update fehlgeschlagen: ${cErr.message}` },
      { status: 500 }
    );
  }

  // 3) Follow-ups auf gesendeten Email-Jobs stoppen
  const { data: followupRows, error: fErr } = await sb
    .from("outreach_jobs")
    .update({ followup_status: "skipped" })
    .eq("channel", "email")
    .eq("status", "sent")
    .is("followup_sent_at", null)
    .in("lead_id", leadIds)
    .select("id, lead_id");
  if (fErr) {
    return NextResponse.json(
      { error: `Follow-up-Stop fehlgeschlagen: ${fErr.message}` },
      { status: 500 }
    );
  }

  const cancelledCount = cancelledRows?.length ?? 0;
  const stoppedCount = followupRows?.length ?? 0;

  console.log(
    `[linkedin/sync-email-jobs] ${leadIds.length} LinkedIn-Leads → ${cancelledCount} pending Email-Jobs cancelled, ${stoppedCount} Follow-ups gestoppt`
  );

  return NextResponse.json({
    ok: true,
    leads_in_linkedin_pipeline: leadIds.length,
    email_pending_cancelled: cancelledCount,
    email_followups_stopped: stoppedCount,
  });
}
