/**
 * Zentraler Helper: Lead als "existing_solar" markieren.
 *
 * Macht in EINER Operation:
 *   1. solar_lead_mass.status = 'existing_solar'
 *   2. existing_solar_at = now, existing_solar_source = <source>
 *   3. ALLE offenen outreach_jobs (pending, beliebiger Channel) → cancelled
 *   4. ALLE gesendeten outreach_jobs ohne Follow-up → followup_status='skipped'
 *
 * Idempotent: kann beliebig oft aufgerufen werden, betroffene Jobs
 * werden nur einmal angefasst.
 *
 * Wird benutzt von:
 *   - Discovery-Enricher (auto-detection während enrichment)
 *   - OSM-Solar-Detection Cron (nightly sweep)
 *   - MaStR-Backfill (Bulk-Import)
 *   - Solar-Detection-Backfill Admin-Tool
 *   - Manuell via "Bereits Solar"-Button auf Lead-Detail
 *   - Sweep-Endpoint (retroaktive Bereinigung)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ExistingSolarSource =
  | "discovery_enrichment"
  | "osm_cron"
  | "osm_backfill"
  | "mastr_backfill"
  | "manual"
  | "legacy"
  | "sweep";

export interface MarkExistingSolarResult {
  status_updated: boolean;
  pending_jobs_cancelled: number;
  followups_stopped: number;
}

/**
 * Markiert einen einzelnen Lead als existing_solar und räumt seine
 * Outreach-Jobs auf. Falls der Lead schon existing_solar war, wird
 * nur die Outreach-Aufräumung durchgeführt (idempotent).
 */
export async function markLeadAsExistingSolar(
  sb: SupabaseClient,
  leadId: string,
  source: ExistingSolarSource
): Promise<MarkExistingSolarResult> {
  const now = new Date().toISOString();

  // Status setzen — nur überschreiben wenn er nicht schon existing_solar ist,
  // damit existing_solar_at den ERSTEN Detection-Zeitpunkt behält.
  const { data: cur } = await sb
    .from("solar_lead_mass")
    .select("status, existing_solar_at")
    .eq("id", leadId)
    .maybeSingle();

  const wasAlreadyMarked = cur?.status === "existing_solar";
  let statusUpdated = false;

  if (!wasAlreadyMarked) {
    const { error: updErr } = await sb
      .from("solar_lead_mass")
      .update({
        status: "existing_solar",
        existing_solar_at: now,
        existing_solar_source: source,
        updated_at: now,
      })
      .eq("id", leadId);
    if (updErr) {
      throw new Error(
        `markLeadAsExistingSolar: status-update fehlgeschlagen für ${leadId}: ${updErr.message}`
      );
    }
    statusUpdated = true;
  } else if (cur?.existing_solar_at == null) {
    // War schon existing_solar aber ohne Tracking-Stempel → nachtragen
    await sb
      .from("solar_lead_mass")
      .update({
        existing_solar_at: now,
        existing_solar_source: source,
      })
      .eq("id", leadId);
  }

  // Outreach-Jobs aufräumen (egal welcher Channel)
  const { data: cancelledRows } = await sb
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      followup_status: "skipped",
      updated_at: now,
    })
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .select("id");
  const cancelledCount = cancelledRows?.length ?? 0;

  const { data: followupStoppedRows } = await sb
    .from("outreach_jobs")
    .update({ followup_status: "skipped", updated_at: now })
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .is("followup_sent_at", null)
    .select("id");
  const followupStopped = followupStoppedRows?.length ?? 0;

  if (cancelledCount > 0 || followupStopped > 0) {
    console.log(
      `[existing-solar] lead=${leadId} source=${source} status_updated=${statusUpdated} cancelled=${cancelledCount} followups_stopped=${followupStopped}`
    );
  }

  return {
    status_updated: statusUpdated,
    pending_jobs_cancelled: cancelledCount,
    followups_stopped: followupStopped,
  };
}
