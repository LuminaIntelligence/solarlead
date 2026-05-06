import { NextResponse } from "next/server";
import { promises as dns } from "dns";
import { requireAdmin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { isImapConfigured } from "@/lib/team/imap-sync";

/**
 * GET /api/admin/outreach/inbound-status
 *
 * Zeigt den Inbound-Setup-Status fürs Admin-Diagnose-Panel.
 * Unterstützt zwei Channels:
 *   - "mailgun" — Webhook-basiert, braucht MX + Signing-Key
 *   - "imap"    — Polling-basiert, braucht IMAP_HOST/USER/PASS + Cron
 *
 * Beide Channels schreiben in dieselbe mailgun_inbound_events-Tabelle,
 * unterschieden durch die `source`-Spalte.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  // Auth via requireAdmin (User-JWT), aber DB-Zugriff via service_role —
  // mailgun_inbound_events / inbound_sync_state haben RLS aktiviert ohne
  // Policies, also kommt nur service_role durch. Sicher: requireAdmin
  // ist die Auth-Schwelle, der Admin-Client nur das DB-Tool.
  const supabase = createAdminClient();

  // ── Detect active channel ──────────────────────────────────────────────────
  const imapConfigured = isImapConfigured();
  const mailgunSigningKeySet = !!(
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY
  );

  // Active channel = whichever is configured. If both, IMAP wins (because
  // the panel shows IMAP as the explicit "I chose Weg C" path).
  const activeChannel: "imap" | "mailgun" = imapConfigured ? "imap" : "mailgun";

  // ── Mailgun-specific: MX records ───────────────────────────────────────────
  const inboundDomain =
    process.env.MAILGUN_INBOUND_DOMAIN ??
    (process.env.MAILGUN_FROM
      ? process.env.MAILGUN_FROM.split("@")[1] ?? null
      : null) ??
    process.env.MAILGUN_DOMAIN ??
    null;

  let mxRecords: { exchange: string; priority: number }[] = [];
  let mxPointsAtMailgun = false;
  let mxError: string | null = null;
  if (inboundDomain) {
    try {
      const records = await dns.resolveMx(inboundDomain);
      mxRecords = records.sort((a, b) => a.priority - b.priority);
      mxPointsAtMailgun = mxRecords.some((r) =>
        /mailgun\.org\.?$/i.test(r.exchange)
      );
    } catch (e) {
      mxError = (e as Error).message;
    }
  }

  // ── IMAP-specific: connection state ────────────────────────────────────────
  let imapState: {
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    messages_checked: number;
    replies_found: number;
    opt_outs_found: number;
  } | null = null;
  let imapStateMissing = false;
  if (imapConfigured) {
    const { data, error } = await supabase
      .from("inbound_sync_state")
      .select(
        "last_run_at, last_success_at, last_error, messages_checked, replies_found, opt_outs_found"
      )
      .eq("channel", "imap")
      .maybeSingle();
    if (error && /relation .* does not exist/i.test(error.message)) {
      imapStateMissing = true;
    } else {
      imapState = data ?? null;
    }
  }

  // ── Sent-job snapshot — both channels need this ────────────────────────────
  const { count: sentCount } = await supabase
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["sent", "opened"]);

  // ── Recent events ──────────────────────────────────────────────────────────
  let recentEvents: Array<{
    id: string;
    received_at: string;
    from_email: string | null;
    recipient: string | null;
    subject: string | null;
    result: string;
    job_id: string | null;
    is_opt_out: boolean;
    error_message: string | null;
    source?: string;
  }> = [];
  let eventsTableMissing = false;
  let sourceColumnMissing = false;
  {
    // Try with source column first
    let { data, error } = await supabase
      .from("mailgun_inbound_events")
      .select(
        "id, received_at, from_email, recipient, subject, result, job_id, is_opt_out, error_message, source"
      )
      .order("received_at", { ascending: false })
      .limit(20);
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        eventsTableMissing = true;
      } else if (/column .* does not exist/i.test(error.message)) {
        // Fallback: events table exists but source column doesn't (mig 20260508 not run)
        sourceColumnMissing = true;
        const fallback = await supabase
          .from("mailgun_inbound_events")
          .select(
            "id, received_at, from_email, recipient, subject, result, job_id, is_opt_out, error_message"
          )
          .order("received_at", { ascending: false })
          .limit(20);
        recentEvents = fallback.data ?? [];
      }
    } else {
      recentEvents = data ?? [];
    }
  }

  // ── 7d aggregate counts ────────────────────────────────────────────────────
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const counts = { matched: 0, no_match: 0, invalid_signature: 0, total: 0 };
  if (!eventsTableMissing) {
    const { data: agg } = await supabase
      .from("mailgun_inbound_events")
      .select("result")
      .gte("received_at", since);
    for (const row of agg ?? []) {
      counts.total++;
      if (row.result === "matched") counts.matched++;
      else if (row.result === "no_match") counts.no_match++;
      else if (row.result === "invalid_signature") counts.invalid_signature++;
    }
  }

  return NextResponse.json({
    active_channel: activeChannel,

    // Mailgun
    signing_key_set: mailgunSigningKeySet,
    inbound_domain: inboundDomain,
    mx_records: mxRecords,
    mx_points_at_mailgun: mxPointsAtMailgun,
    mx_error: mxError,

    // IMAP
    imap_configured: imapConfigured,
    imap_host: process.env.IMAP_HOST ?? null,
    imap_user: process.env.IMAP_USER ?? null,
    imap_state: imapState,
    imap_state_missing: imapStateMissing,

    // Common
    sent_job_count: sentCount ?? 0,
    events_table_missing: eventsTableMissing,
    source_column_missing: sourceColumnMissing,
    recent_events: recentEvents,
    counts_7d: counts,
    webhook_url: "https://solarleadgen.lumina-intelligence.ai/api/webhooks/mailgun-inbound",
  });
}
