import { NextResponse } from "next/server";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { ImapFlow } from "imapflow";

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

/** Extract plain text body from raw email source */
function extractBodyText(rawEmail: string): string {
  // Remove headers (everything before the first blank line)
  const bodyStart = rawEmail.indexOf("\r\n\r\n");
  const body = bodyStart >= 0 ? rawEmail.slice(bodyStart + 4) : rawEmail;

  // Strip quoted reply lines ("> ...")
  const lines = body.split(/\r?\n/);
  const cleaned = lines
    .filter((l) => !l.startsWith(">") && !l.startsWith("&gt;"))
    .join("\n")
    .replace(/=\r?\n/g, "") // decode quoted-printable soft line breaks
    .replace(/={2}[0-9A-F]{2}/gi, "") // decode remaining QP sequences
    .replace(/<[^>]+>/g, " ") // strip HTML tags
    .replace(/\s{2,}/g, " ") // collapse whitespace
    .trim();

  return cleaned.slice(0, 2000);
}

/**
 * POST /api/admin/outreach/sync-replies
 * Polls configured IMAP inbox for unseen messages, matches senders against
 * outreach_jobs.contact_email, and marks jobs as replied or opted_out.
 */
export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT ?? "993");
  const imapUser = process.env.IMAP_USER;
  const imapPass = process.env.IMAP_PASS;
  const secure = process.env.IMAP_SECURE !== "false";

  if (!host || !imapUser || !imapPass) {
    return NextResponse.json(
      {
        error:
          "IMAP nicht konfiguriert. Bitte IMAP_HOST, IMAP_USER und IMAP_PASS in .env.local setzen.",
        configured: false,
      },
      { status: 400 }
    );
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
  });

  let messagesChecked = 0;
  let repliesFound = 0;
  let optedOutFound = 0;
  const errors: string[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Fetch UIDs of all unseen messages (imapflow uses seen:false, not unseen:true)
      const searchResult = await client.search({ seen: false }, { uid: true });
      const unseenUids: number[] = searchResult === false ? [] : searchResult;

      for (const uid of unseenUids) {
        try {
          messagesChecked++;

          // Fetch envelope (From address) — lightweight
          const envelope = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
          if (!envelope) continue;
          const fromAddress = envelope.envelope?.from?.[0]?.address?.toLowerCase();
          if (!fromAddress) continue;

          // Match against any sent outreach job for this email
          const { data: job } = await supabase
            .from("outreach_jobs")
            .select("id, status, followup_status")
            .ilike("contact_email", fromAddress)
            .in("status", ["sent", "opened"])
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!job) continue;

          // Fetch raw source for body extraction
          const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!full) continue;
          const rawEmail = full.source?.toString("utf-8") ?? "";
          const bodyText = extractBodyText(rawEmail);

          const isOptOut = detectOptOut(bodyText);
          const newStatus = isOptOut ? "opted_out" : "replied";

          // Update job status
          await supabase
            .from("outreach_jobs")
            .update({
              status: newStatus,
              replied_at: new Date().toISOString(),
              reply_content: bodyText.slice(0, 1000),
              // Cancel pending follow-up — no point following up on a reply
              followup_status:
                job.followup_status === "pending" ? "skipped" : job.followup_status,
            })
            .eq("id", job.id);

          // Mark email as seen in IMAP
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });

          if (isOptOut) optedOutFound++;
          else repliesFound++;
        } catch (msgErr) {
          errors.push(`UID ${uid}: ${(msgErr as Error).message}`);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    return NextResponse.json(
      {
        error: `IMAP-Verbindungsfehler: ${(err as Error).message}`,
        configured: true,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    messagesChecked,
    repliesFound,
    optedOutFound,
    errors: errors.slice(0, 5),
    configured: true,
    syncedAt: new Date().toISOString(),
  });
}

/**
 * GET /api/admin/outreach/sync-replies
 * Returns IMAP configuration status (without credentials).
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  return NextResponse.json({
    configured: !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS),
    host: process.env.IMAP_HOST ?? null,
    user: process.env.IMAP_USER ?? null,
  });
}
