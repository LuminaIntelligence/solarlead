/**
 * Health Tracker — single point of truth for "is the discovery automation OK?"
 *
 * Emits structured events into system_health_events. The /admin/discovery/health
 * dashboard reads these. Critical events (severity='error', or repeated failures)
 * also trigger an email alert via Mailgun if alert_email is configured.
 *
 * Design goals:
 *   - Cron-tick writes a heartbeat on EVERY run → if no heartbeat for >15min,
 *     dashboard shows red status
 *   - Errors are deduped in 1h windows so a broken provider doesn't spam alerts
 *   - Daily summary email gives a passive "still alive" signal
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/providers/email/mailgun";

export type HealthKind = "heartbeat" | "info" | "warning" | "error" | "alert_sent";

export interface HealthEvent {
  source: string;
  kind: HealthKind;
  message: string;
  context?: Record<string, unknown>;
}

/** Write an event row. Best-effort: never throws into caller. */
export async function recordHealth(
  adminSupabase: ReturnType<typeof createAdminClient>,
  event: HealthEvent
): Promise<void> {
  try {
    await adminSupabase.from("system_health_events").insert({
      source: event.source,
      kind: event.kind,
      message: event.message,
      context: event.context ?? null,
    });
  } catch (e) {
    // Don't let logging failures break the actual work
    console.error("[health-tracker] insert failed:", e);
  }
}

/**
 * Get the last heartbeat time. Used by the dashboard to compute "X minutes ago".
 */
export async function getLastHeartbeat(
  adminSupabase: ReturnType<typeof createAdminClient>,
  source = "discovery_tick"
): Promise<Date | null> {
  const { data } = await adminSupabase
    .from("system_health_events")
    .select("ts")
    .eq("source", source)
    .eq("kind", "heartbeat")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.ts ? new Date(data.ts as string) : null;
}

/**
 * Send a critical alert email — but only if:
 *   1. alert_email is configured in user_settings
 *   2. We haven't already alerted on the same kind since `dedupSince`
 *      (default: 60 min ago — prevents email floods when an API key is broken)
 *
 * Special-case `budget_exceeded`: dedup-Fenster reicht standardmäßig bis
 * zur nächsten UTC-Mitternacht (= Reset des Tagesbudgets), damit der
 * Admin nur EINMAL pro Tag eine Mail bekommt, statt alle 4-5 Min beim
 * jedem Cron-Tick.
 *
 * Returns true if an email was actually sent.
 */
export async function sendAlertIfFresh(
  adminSupabase: ReturnType<typeof createAdminClient>,
  alertKind: string,    // 'budget_exceeded' | 'cell_repeat_failure' | 'no_heartbeat' | ...
  subject: string,
  message: string,
  context: Record<string, unknown> = {},
  dedupSince?: string   // ISO-timestamp; default: -60min, oder Mitternacht für budget_exceeded
): Promise<boolean> {
  // Default dedup-Fenster
  if (!dedupSince) {
    if (alertKind === "budget_exceeded") {
      // Reset bei UTC-Mitternacht (dasselbe wann das Tagesbudget reset wird).
      // Heißt: einmal pro Tag, egal wie oft der Cron-Tick "Budget voll" sieht.
      const midnight = new Date();
      midnight.setUTCHours(0, 0, 0, 0);
      dedupSince = midnight.toISOString();
    } else {
      dedupSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }
  }
  // Find admin alert_email
  const { data: settings } = await adminSupabase
    .from("user_settings")
    .select("alert_email")
    .eq("role", "admin")
    .not("alert_email", "is", null)
    .limit(1)
    .maybeSingle();

  const to = settings?.alert_email as string | undefined;
  if (!to) {
    // No alert_email configured — log and skip
    await recordHealth(adminSupabase, {
      source: "alert",
      kind: "warning",
      message: `Alert '${alertKind}' suppressed: no alert_email configured`,
      context: { subject, alert_kind: alertKind },
    });
    return false;
  }

  // Dedup: any 'alert_sent' event with same alertKind since `dedupSince`?
  const { data: recent } = await adminSupabase
    .from("system_health_events")
    .select("id")
    .eq("kind", "alert_sent")
    .gte("ts", dedupSince)
    .filter("context->>alert_kind", "eq", alertKind)
    .limit(1)
    .maybeSingle();

  if (recent) {
    // Already alerted recently for this kind — don't spam
    return false;
  }

  // Send the email
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="color: #b91c1c;">⚠ SolarLead — ${subject}</h2>
      <p>${message.replace(/\n/g, "<br>")}</p>
      <hr style="margin-top: 32px; border: 0; border-top: 1px solid #ddd;">
      <p style="font-size: 12px; color: #666;">
        Diese E-Mail wurde automatisch verschickt vom System.
        Kontext:
      </p>
      <pre style="font-size: 11px; background: #f5f5f5; padding: 8px; border-radius: 4px; overflow: auto;">${JSON.stringify(context, null, 2)}</pre>
      <p style="font-size: 12px; color: #666;">
        Health-Dashboard: <a href="${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/admin/discovery/health">/admin/discovery/health</a>
      </p>
    </div>
  `.trim();

  const text =
    `⚠ SolarLead — ${subject}\n\n${message}\n\n---\n` +
    `Kontext: ${JSON.stringify(context)}\n` +
    `Health-Dashboard: ${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/admin/discovery/health`;

  const result = await sendEmail({
    to,
    subject: `[SolarLead] ${subject}`,
    html,
    text,
    "o:tag": ["alert", alertKind],
  });

  if (result) {
    await recordHealth(adminSupabase, {
      source: "alert",
      kind: "alert_sent",
      message: `Alert '${alertKind}' sent to ${to}: ${subject}`,
      context: { ...context, alert_kind: alertKind, mailgun_id: result.id, to },
    });
    return true;
  } else {
    await recordHealth(adminSupabase, {
      source: "alert",
      kind: "error",
      message: `Failed to send alert email for '${alertKind}'`,
      context: { ...context, alert_kind: alertKind, to },
    });
    return false;
  }
}

/**
 * Check whether the discovery automation appears stuck (no heartbeat in N min).
 * Called periodically by the cron tick itself, plus by the health dashboard.
 */
export function isHeartbeatStale(lastHeartbeat: Date | null, maxAgeMin = 15): boolean {
  if (!lastHeartbeat) return true;
  const ageMs = Date.now() - lastHeartbeat.getTime();
  return ageMs > maxAgeMin * 60 * 1000;
}
