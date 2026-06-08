/**
 * Zentraler Helper: Lead als "existing_solar" markieren.
 *
 * Macht in EINER Operation:
 *   1. solar_lead_mass.status = 'existing_solar'
 *   2. existing_solar_at = now, existing_solar_source = <source>
 *      (falls die Spalten existieren — sonst graceful degradation)
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
 *
 * Robust gegen fehlende Migration 20260605_existing_solar_tracking.sql —
 * fällt automatisch auf Status-only-Update zurück wenn die neuen
 * Tracking-Spalten nicht existieren.
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

// Cache: einmal pro Prozess prüfen ob die Tracking-Spalten verfügbar sind.
// Wird nach dem ersten Aufruf gesetzt — kein wiederholter Probe-Roundtrip.
let trackingColsKnownState: "unknown" | "present" | "missing" = "unknown";

/** Erkennt typische Postgres-"column does not exist"-Fehler. */
function isMissingColumnError(err: { code?: string; message?: string }): boolean {
  if (err.code === "42703") return true; // Postgres: undefined_column
  const m = (err.message ?? "").toLowerCase();
  return (
    m.includes("existing_solar_at") ||
    m.includes("existing_solar_source") ||
    (m.includes("column") && m.includes("does not exist"))
  );
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

  // Status auslesen (nur status, nicht existing_solar_at — das wäre fragil
  // wenn die Migration fehlt)
  const { data: cur } = await sb
    .from("solar_lead_mass")
    .select("status")
    .eq("id", leadId)
    .maybeSingle();

  const wasAlreadyMarked = cur?.status === "existing_solar";
  let statusUpdated = false;

  if (!wasAlreadyMarked) {
    // Versuche Update mit allen Tracking-Spalten — fallback wenn migration fehlt
    const fullPayload: Record<string, unknown> = {
      status: "existing_solar",
      updated_at: now,
    };
    if (trackingColsKnownState !== "missing") {
      fullPayload.existing_solar_at = now;
      fullPayload.existing_solar_source = source;
    }

    const { error: updErr } = await sb
      .from("solar_lead_mass")
      .update(fullPayload)
      .eq("id", leadId);

    if (updErr) {
      if (isMissingColumnError(updErr) && trackingColsKnownState !== "missing") {
        // Migration nicht ausgeführt → degradieren auf minimalen Payload
        console.warn(
          `[markLeadAsExistingSolar] Tracking-Spalten fehlen — Migration 20260605_existing_solar_tracking.sql ausführen. Falle auf status-only Update zurück.`
        );
        trackingColsKnownState = "missing";
        const { error: retryErr } = await sb
          .from("solar_lead_mass")
          .update({ status: "existing_solar", updated_at: now })
          .eq("id", leadId);
        if (retryErr) {
          throw new Error(
            `markLeadAsExistingSolar: status-update (fallback) fehlgeschlagen für ${leadId}: ${retryErr.message}`
          );
        }
        statusUpdated = true;
      } else {
        throw new Error(
          `markLeadAsExistingSolar: status-update fehlgeschlagen für ${leadId}: ${updErr.message}`
        );
      }
    } else {
      statusUpdated = true;
      if (trackingColsKnownState === "unknown") trackingColsKnownState = "present";
    }
  }

  // Outreach-Jobs aufräumen (egal welcher Channel) — die Spalten hier
  // (status, followup_status, updated_at) existieren in jedem Fall.
  const { data: cancelledRows, error: cErr } = await sb
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      followup_status: "skipped",
      updated_at: now,
    })
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .select("id");
  if (cErr) {
    console.warn(
      `[markLeadAsExistingSolar] cancel pending failed for ${leadId}: ${cErr.message}`
    );
  }
  const cancelledCount = cancelledRows?.length ?? 0;

  const { data: followupStoppedRows, error: fErr } = await sb
    .from("outreach_jobs")
    .update({ followup_status: "skipped", updated_at: now })
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .is("followup_sent_at", null)
    .select("id");
  if (fErr) {
    console.warn(
      `[markLeadAsExistingSolar] stop followups failed for ${leadId}: ${fErr.message}`
    );
  }
  const followupStopped = followupStoppedRows?.length ?? 0;

  if (statusUpdated || cancelledCount > 0 || followupStopped > 0) {
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
