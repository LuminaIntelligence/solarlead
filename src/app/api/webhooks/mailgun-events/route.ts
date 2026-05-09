import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as crypto from "crypto";

/**
 * POST /api/webhooks/mailgun-events
 *
 * Empfängt Mailgun-Tracking-Events (delivered, opened, clicked, failed,
 * permanent_failure, complained, unsubscribed). Mailgun postet jeden
 * Event als JSON an diese URL, sobald er ihn registriert hat.
 *
 * Setup in Mailgun-Dashboard: Sending → Webhooks → Add Webhook URL für
 * jeden Event-Typ den du tracken willst, jeweils mit dieser URL.
 *
 * Job-Match: Mailgun gibt unsere beim Send gesetzte Custom-Variable
 * v:job-id im Event-Payload zurück (event-data.user-variables.job-id).
 * Über die finden wir den outreach_job und updaten die passende Spalte.
 */

function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string
): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY;
  if (!signingKey) return false;
  const value = timestamp + token;
  const expected = crypto.createHmac("sha256", signingKey).update(value).digest("hex");
  return expected === signature;
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Mailgun-Webhook-Format: { signature: {timestamp, token, signature}, "event-data": {...} }
  const sig = payload.signature ?? {};
  const eventData = payload["event-data"] ?? {};

  // Signature verifizieren (skip wenn Key nicht gesetzt — dev mode)
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY;
  if (signingKey && !verifyMailgunSignature(sig.timestamp ?? "", sig.token ?? "", sig.signature ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event: string = eventData.event ?? "";
  const userVars = eventData["user-variables"] ?? {};
  const jobId: string | null = userVars["job-id"] ?? null;
  const recipient: string | null = eventData.recipient ?? null;
  const messageId: string | null = eventData.message?.headers?.["message-id"] ?? null;
  const url: string | null = eventData.url ?? null;
  const reason: string | null = eventData.reason ?? eventData["delivery-status"]?.message ?? null;

  const adminSb = createAdminClient();

  // Event auf jeden Fall loggen — auch wenn kein job-id (Audit-Trail)
  await adminSb.from("mailgun_events").insert({
    event,
    job_id: jobId,
    recipient,
    message_id: messageId,
    url,
    reason,
    raw_payload: payload,
  });

  if (!jobId) {
    return NextResponse.json({ ok: true, skipped: "no_job_id" });
  }

  // Map Event → DB-Update
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  switch (event) {
    case "delivered":
      // first-write-wins
      update.delivered_at = now;
      // Optional: status auf 'sent' bestätigen wenn er noch auf 'pending' steht
      break;

    case "opened":
      // first open + count
      update.opens_count = await incrementCount(adminSb, jobId, "opens_count");
      // first-write-wins für opened_at
      update.opened_at = await firstTimestampOnly(adminSb, jobId, "opened_at", now);
      break;

    case "clicked":
      update.clicks_count = await incrementCount(adminSb, jobId, "clicks_count");
      update.clicked_at = await firstTimestampOnly(adminSb, jobId, "clicked_at", now);
      // Click impliziert open
      update.opened_at = await firstTimestampOnly(adminSb, jobId, "opened_at", now);
      break;

    case "failed":
    case "permanent_failure":
      update.bounced_at = now;
      update.bounce_reason = reason;
      // Status auf 'bounced' wenn nicht schon repliziert/opted-out
      break;

    case "complained":
      // Spam-Beschwerde
      update.complained_at = now;
      break;

    case "unsubscribed":
      update.unsubscribed_at = now;
      break;

    default:
      // unknown event — nur geloggt, nicht in outreach_jobs gespiegelt
      return NextResponse.json({ ok: true, event, logged: true });
  }

  // Update outreach_jobs (best-effort, idempotent)
  if (Object.keys(update).length > 0) {
    await adminSb.from("outreach_jobs").update(update).eq("id", jobId);
  }

  return NextResponse.json({ ok: true, event, jobId });
}

// Hilfsfunktion: liest aktuellen Count und gibt +1 zurück.
// Race-condition-tolerant: bei Mailgun bekommen wir keine Burst-Updates,
// und wenn doch ein Open verloren geht, ist das für das Tracking-Bild
// unkritisch.
async function incrementCount(
  sb: ReturnType<typeof createAdminClient>,
  jobId: string,
  column: "opens_count" | "clicks_count"
): Promise<number> {
  const { data } = await sb
    .from("outreach_jobs")
    .select(column)
    .eq("id", jobId)
    .maybeSingle();
  const current = ((data as Record<string, unknown> | null)?.[column] as number | null) ?? 0;
  return current + 1;
}

// Hilfsfunktion: gibt den existing-Wert zurück wenn schon gesetzt, sonst now.
// Mailgun-Events können retried werden — wir wollen den ERSTEN Open-Zeitpunkt
// behalten, nicht jeden Retry überschreiben.
async function firstTimestampOnly(
  sb: ReturnType<typeof createAdminClient>,
  jobId: string,
  column: "opened_at" | "clicked_at",
  fallback: string
): Promise<string> {
  const { data } = await sb
    .from("outreach_jobs")
    .select(column)
    .eq("id", jobId)
    .maybeSingle();
  const existing = (data as Record<string, unknown> | null)?.[column] as string | null;
  return existing ?? fallback;
}
