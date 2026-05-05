import { NextResponse } from "next/server";
import { promises as dns } from "dns";
import { requireAdmin } from "@/lib/auth/admin-gate";

/**
 * GET /api/admin/outreach/inbound-status
 * Diagnostic for the Mailgun-Inbound setup. Reports:
 *   - Whether MAILGUN_WEBHOOK_SIGNING_KEY is set on the server
 *   - MX records for the inbound domain (must point at Mailgun)
 *   - Sent-job count (so admin can tell if "no replies" is because
 *     no outreach actually went out yet)
 *   - Last 20 webhook events, so missing/failed calls are visible
 *
 * The inbound domain is taken from MAILGUN_INBOUND_DOMAIN env (preferred),
 * or derived from MAILGUN_FROM / MAILGUN_DOMAIN. Outbound and inbound can
 * differ — Mailgun lets you receive on a separate domain.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const signingKeySet = !!(
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY
  );

  // Resolve inbound domain
  const inboundDomain =
    process.env.MAILGUN_INBOUND_DOMAIN ??
    (process.env.MAILGUN_FROM
      ? process.env.MAILGUN_FROM.split("@")[1] ?? null
      : null) ??
    process.env.MAILGUN_DOMAIN ??
    null;

  // MX lookup
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

  // Sent-job snapshot — answers "ist überhaupt was rausgegangen?"
  const { count: sentCount } = await supabase
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["sent", "opened"]);

  // Last 20 webhook events (table created in 20260507 migration)
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
  }> = [];
  let eventsTableMissing = false;
  {
    const { data, error } = await supabase
      .from("mailgun_inbound_events")
      .select(
        "id, received_at, from_email, recipient, subject, result, job_id, is_opt_out, error_message"
      )
      .order("received_at", { ascending: false })
      .limit(20);
    if (error) {
      // Migration not run yet
      if (/relation .* does not exist/i.test(error.message)) {
        eventsTableMissing = true;
      }
    } else {
      recentEvents = data ?? [];
    }
  }

  // Aggregate counters from the events log (rolling 7d)
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
    signing_key_set: signingKeySet,
    inbound_domain: inboundDomain,
    mx_records: mxRecords,
    mx_points_at_mailgun: mxPointsAtMailgun,
    mx_error: mxError,
    sent_job_count: sentCount ?? 0,
    events_table_missing: eventsTableMissing,
    recent_events: recentEvents,
    counts_7d: counts,
    webhook_url: "https://solarleadgen.lumina-intelligence.ai/api/webhooks/mailgun-inbound",
  });
}
