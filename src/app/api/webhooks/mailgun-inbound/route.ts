import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignJob } from "@/lib/team/auto-assign";
import * as crypto from "crypto";

const OPT_OUT_KEYWORDS = [
  "abmelden", "abbestellen", "austragen", "kein interesse",
  "nicht interessiert", "bitte entfernen", "entfernen sie mich",
  "bitte löschen", "keine e-mails mehr", "keine emails mehr",
  "unsubscribe", "opt out", "opt-out", "remove me",
  "no thanks", "no thank you", "nicht kontaktieren",
];

function detectOptOut(text: string): boolean {
  const lower = text.toLowerCase();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Strip quoted reply lines and excessive whitespace */
function cleanBody(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">") && !l.startsWith("On ") && !l.match(/^-{3,}/))
    .join("\n")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000);
}

/**
 * Verify Mailgun webhook signature.
 * Uses MAILGUN_WEBHOOK_SIGNING_KEY (from Mailgun dashboard → Webhooks).
 * Falls back to MAILGUN_API_KEY if not set.
 */
function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string
): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY;
  if (!signingKey) return false;

  const value = timestamp + token;
  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(value)
    .digest("hex");

  return expected === signature;
}

/**
 * POST /api/webhooks/mailgun-inbound
 * Mailgun Inbound Route webhook — called for every incoming email.
 * Configure in Mailgun: Routes → + Create Route → Match recipient → Forward to this URL.
 */
export async function POST(req: NextRequest) {
  // Mailgun sends multipart/form-data
  const formData = await req.formData();

  const timestamp = formData.get("timestamp")?.toString() ?? "";
  const token     = formData.get("token")?.toString() ?? "";
  const signature = formData.get("signature")?.toString() ?? "";

  // Verify signature (skip in dev if no key set)
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? process.env.MAILGUN_API_KEY;
  if (signingKey && !verifyMailgunSignature(timestamp, token, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Extract email fields
  const fromRaw   = formData.get("from")?.toString() ?? "";       // "Name <email@example.com>"
  const sender    = formData.get("sender")?.toString() ?? "";     // "email@example.com"
  const bodyPlain = formData.get("body-plain")?.toString() ?? ""; // plain text body

  // Resolve sender address — prefer `sender` (clean), fall back to parsing `from`
  const fromEmail = (
    sender ||
    fromRaw.match(/<([^>]+)>/)?.[1] ||
    fromRaw
  ).toLowerCase().trim();

  if (!fromEmail) {
    return NextResponse.json({ ok: true, skipped: "no_from_address" });
  }

  const bodyText = cleanBody(bodyPlain);
  const isOptOut = detectOptOut(bodyText);
  const newStatus = isOptOut ? "opted_out" : "replied";

  // Find matching outreach job
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("outreach_jobs")
    .select("id, status, followup_status")
    .ilike("contact_email", fromEmail)
    .in("status", ["sent", "opened"])
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) {
    // No matching job — could be an unrelated email, silently accept
    return NextResponse.json({ ok: true, skipped: "no_matching_job" });
  }

  // Update job. Set outcome='new' so the team inbox picks it up + bump
  // last_activity_at for SLA tracking. Mirror of the IMAP sync-replies logic
  // so both ingestion paths produce the same result.
  const repliedAt = new Date().toISOString();
  await supabase
    .from("outreach_jobs")
    .update({
      status: newStatus,
      replied_at: repliedAt,
      reply_content: bodyText.slice(0, 1000),
      outcome: isOptOut ? "not_interested" : "new",
      outcome_at: repliedAt,
      last_activity_at: repliedAt,
      // Cancel pending follow-up
      followup_status: job.followup_status === "pending" ? "skipped" : job.followup_status,
    })
    .eq("id", job.id);

  // Auto-assign non-opt-out replies to a specialist via round-robin.
  // Best-effort: if no specialist exists, the reply stays unassigned in pool.
  let assignedTo: string | null = null;
  if (!isOptOut) {
    try {
      const adminSb = createAdminClient();
      const result = await autoAssignJob(adminSb, job.id as string);
      assignedTo = result.assignedTo;
    } catch (e) {
      console.warn("[mailgun-inbound] auto-assign failed for", job.id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    job_id: job.id,
    status: newStatus,
    from: fromEmail,
    assigned_to: assignedTo,
  });
}
