/**
 * POST /api/admin/outreach/existing-solar-sweep
 *
 * Admin-callable Variante des Cron-Sweeps. Findet alle Leads mit
 * status='existing_solar' und räumt ihre offenen Outreach-Jobs auf:
 *   - pending (Email + LinkedIn) → status='cancelled'
 *   - sent    (Email + LinkedIn) ohne Follow-up → followup_status='skipped'
 *
 * Idempotent. Wird vom "Solar-Leads entfernen"-Button im LinkedIn-Outreach
 * Dashboard ausgelöst, falls die nächtliche Cron-Variante nicht greift.
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const sb = createAdminClient();
  const now = new Date().toISOString();

  // 1) Alle existing_solar Leads
  const { data: solarLeads, error: sErr } = await sb
    .from("solar_lead_mass")
    .select("id")
    .eq("status", "existing_solar");
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  const leadIds = (solarLeads ?? []).map((l) => l.id as string);

  if (leadIds.length === 0) {
    return NextResponse.json({
      ok: true,
      existing_solar_leads: 0,
      pending_email_cancelled: 0,
      pending_linkedin_cancelled: 0,
      followups_stopped: 0,
    });
  }

  // 2) Pending Email-Jobs stornieren
  let pendingEmailCancelled = 0;
  let pendingLinkedInCancelled = 0;
  let followupsStopped = 0;

  for (let i = 0; i < leadIds.length; i += 500) {
    const chunk = leadIds.slice(i, i + 500);

    const { data: cancelledEmail } = await sb
      .from("outreach_jobs")
      .update({ status: "cancelled", followup_status: "skipped", updated_at: now })
      .in("lead_id", chunk)
      .eq("channel", "email")
      .eq("status", "pending")
      .select("id");
    pendingEmailCancelled += cancelledEmail?.length ?? 0;

    const { data: cancelledLi } = await sb
      .from("outreach_jobs")
      .update({ status: "cancelled", followup_status: "skipped", updated_at: now })
      .in("lead_id", chunk)
      .eq("channel", "linkedin")
      .eq("status", "pending")
      .select("id");
    pendingLinkedInCancelled += cancelledLi?.length ?? 0;

    const { data: stopped } = await sb
      .from("outreach_jobs")
      .update({ followup_status: "skipped", updated_at: now })
      .in("lead_id", chunk)
      .eq("status", "sent")
      .is("followup_sent_at", null)
      .select("id");
    followupsStopped += stopped?.length ?? 0;
  }

  console.log(
    `[admin/existing-solar-sweep] ${leadIds.length} existing_solar Leads → ` +
    `${pendingEmailCancelled} pending email cancelled, ` +
    `${pendingLinkedInCancelled} pending linkedin cancelled, ` +
    `${followupsStopped} follow-ups stopped`
  );

  return NextResponse.json({
    ok: true,
    existing_solar_leads: leadIds.length,
    pending_email_cancelled: pendingEmailCancelled,
    pending_linkedin_cancelled: pendingLinkedInCancelled,
    followups_stopped: followupsStopped,
  });
}
