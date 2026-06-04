/**
 * GET /api/cron/outreach-existing-solar-sweep
 *
 * Daily-Cron. Findet alle Leads mit status='existing_solar' und räumt
 * deren offene Outreach-Jobs (Email + LinkedIn) auf:
 *   - pending  → status='cancelled'
 *   - sent     → followup_status='skipped' (kein Follow-up mehr)
 *
 * Idempotent: betroffene Jobs sind danach 'cancelled' und werden beim
 * nächsten Lauf nicht erneut angefasst.
 *
 * Backup-Layer falls in einem Code-Pfad mal vergessen wird die Jobs
 * synchron zu stornieren beim Markieren als existing_solar.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  if (req.headers.get("x-cron-secret") === expected) return true;
  if (req.nextUrl.searchParams.get("secret") === expected) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      pending_cancelled: 0,
      followups_stopped: 0,
    });
  }

  // 2) Pending Outreach-Jobs (alle Channels) stornieren — in Chunks von 500
  let pendingCancelled = 0;
  for (let i = 0; i < leadIds.length; i += 500) {
    const chunk = leadIds.slice(i, i + 500);
    const { data: rows } = await sb
      .from("outreach_jobs")
      .update({ status: "cancelled", followup_status: "skipped", updated_at: now })
      .in("lead_id", chunk)
      .eq("status", "pending")
      .select("id");
    pendingCancelled += rows?.length ?? 0;
  }

  // 3) Sent Outreach-Jobs ohne Follow-up: Follow-up unterbinden
  let followupsStopped = 0;
  for (let i = 0; i < leadIds.length; i += 500) {
    const chunk = leadIds.slice(i, i + 500);
    const { data: rows } = await sb
      .from("outreach_jobs")
      .update({ followup_status: "skipped", updated_at: now })
      .in("lead_id", chunk)
      .eq("status", "sent")
      .is("followup_sent_at", null)
      .select("id");
    followupsStopped += rows?.length ?? 0;
  }

  console.log(
    `[outreach-existing-solar-sweep] ${leadIds.length} existing_solar Leads → ${pendingCancelled} pending cancelled, ${followupsStopped} follow-ups stopped`
  );

  return NextResponse.json({
    ok: true,
    existing_solar_leads: leadIds.length,
    pending_cancelled: pendingCancelled,
    followups_stopped: followupsStopped,
  });
}
