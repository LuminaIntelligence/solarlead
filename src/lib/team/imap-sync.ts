/**
 * Shared IMAP-Pull sync logic.
 *
 * Used by:
 *   - POST /api/admin/outreach/sync-replies (manuell vom Admin)
 *   - GET  /api/cron/imap-sync             (alle 10 min via GitHub Actions)
 *
 * Connects to the configured IMAP inbox, scans unseen messages, matches
 * senders against outreach_jobs.contact_email (status sent/opened),
 * marks matches as replied (or opted_out), assigns via round-robin,
 * and writes one row per processed message to mailgun_inbound_events.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignJob } from "@/lib/team/auto-assign";

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

/**
 * Extract clean plain text from a raw RFC822 email.
 * Uses mailparser to handle multipart MIME, quoted-printable decoding,
 * charset conversion (iso-8859-1, utf-8, etc.) and HTML→text fallback.
 *
 * Strips quoted reply lines, signatures, and collapses whitespace so
 * the team-inbox shows a clean readable preview instead of MIME garbage.
 */
async function extractBodyText(rawEmail: string): Promise<string> {
  try {
    const parsed = await simpleParser(rawEmail, {
      skipHtmlToText: false,
      skipImageLinks: true,
      skipTextLinks: false,
    });

    // Prefer text body; fall back to HTML-converted text
    let text = (parsed.text ?? parsed.html ?? "").toString();

    // Strip quoted reply lines ("> ...") and "On ... wrote:" headers
    text = text
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith(">"))
      .filter((l) => !/^On .{1,80} wrote:\s*$/i.test(l))
      .filter((l) => !/^Am .{1,80} schrieb .{1,80}:\s*$/i.test(l))
      .filter((l) => !/^Von:\s/i.test(l))
      .filter((l) => !/^Gesendet:\s/i.test(l))
      .filter((l) => !/^An:\s/i.test(l))
      .filter((l) => !/^Betreff:\s/i.test(l))
      .join("\n");

    // Cut at "-----Original Message-----" / "-- " signature delimiter
    const sigIdx = text.search(/^(-{2,5}\s?Original.*|--\s*$)/m);
    if (sigIdx > 0) text = text.slice(0, sigIdx);

    // Collapse 3+ blank lines
    text = text
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 2000);

    return text;
  } catch (e) {
    console.warn("[imap-sync] mail parsing failed, falling back to raw:", e);
    return rawEmail.slice(0, 2000);
  }
}

export interface ImapSyncResult {
  ok: boolean;
  configured: boolean;
  messagesChecked: number;
  repliesFound: number;
  optedOutFound: number;
  errors: string[];
  errorMessage?: string;
}

export function isImapConfigured(): boolean {
  return !!(
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASS
  );
}

export async function runImapSync(): Promise<ImapSyncResult> {
  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT ?? "993");
  const imapUser = process.env.IMAP_USER;
  const imapPass = process.env.IMAP_PASS;
  const secure = process.env.IMAP_SECURE !== "false";

  if (!host || !imapUser || !imapPass) {
    return {
      ok: false,
      configured: false,
      messagesChecked: 0,
      repliesFound: 0,
      optedOutFound: 0,
      errors: [],
      errorMessage:
        "IMAP nicht konfiguriert. Bitte IMAP_HOST, IMAP_USER und IMAP_PASS in .env.local setzen.",
    };
  }

  const adminSb = createAdminClient();
  const startedAt = new Date().toISOString();

  // Update sync_state immediately so panel shows "running"
  await adminSb.from("inbound_sync_state").upsert({
    channel: "imap",
    last_run_at: startedAt,
  });

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
      const searchResult = await client.search({ seen: false }, { uid: true });
      const unseenUids: number[] = searchResult === false ? [] : searchResult;

      for (const uid of unseenUids) {
        try {
          messagesChecked++;

          // Envelope first (lightweight: from + subject)
          const envelope = await client.fetchOne(
            String(uid),
            { envelope: true },
            { uid: true }
          );
          if (!envelope) continue;
          const fromAddress = envelope.envelope?.from?.[0]?.address?.toLowerCase() ?? null;
          const recipient = envelope.envelope?.to?.[0]?.address?.toLowerCase() ?? null;
          const subject = envelope.envelope?.subject ?? null;

          if (!fromAddress) {
            await adminSb.from("mailgun_inbound_events").insert({
              source: "imap",
              from_email: null,
              recipient,
              subject,
              result: "no_from_address",
            });
            continue;
          }

          // Match against any sent outreach job for this email
          const { data: job } = await adminSb
            .from("outreach_jobs")
            .select("id, status, followup_status")
            .ilike("contact_email", fromAddress)
            .in("status", ["sent", "opened"])
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!job) {
            await adminSb.from("mailgun_inbound_events").insert({
              source: "imap",
              from_email: fromAddress,
              recipient,
              subject,
              result: "no_match",
              error_message:
                "No outreach_jobs row with status sent/opened for this sender",
            });
            // Don't mark as seen — admin may want to handle manually
            continue;
          }

          // Fetch full body for opt-out detection
          const full = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: true }
          );
          const rawEmail = full
            ? (full as { source?: Buffer }).source?.toString("utf-8") ?? ""
            : "";
          const bodyText = await extractBodyText(rawEmail);
          const isOptOut = detectOptOut(bodyText);
          const newStatus = isOptOut ? "opted_out" : "replied";

          // Update job
          const repliedAt = new Date().toISOString();
          await adminSb
            .from("outreach_jobs")
            .update({
              status: newStatus,
              replied_at: repliedAt,
              reply_content: bodyText.slice(0, 1000),
              outcome: isOptOut ? "not_interested" : "new",
              outcome_at: repliedAt,
              last_activity_at: repliedAt,
              followup_status:
                job.followup_status === "pending"
                  ? "skipped"
                  : job.followup_status,
            })
            .eq("id", job.id);

          // Mark email as seen in IMAP — only after successful DB write
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });

          // Auto-assign
          let assignedTo: string | null = null;
          if (!isOptOut) {
            try {
              const result = await autoAssignJob(adminSb, job.id as string);
              assignedTo = result.assignedTo;
            } catch (e) {
              console.warn("[imap-sync] auto-assign failed for", job.id, e);
            }
          }

          await adminSb.from("mailgun_inbound_events").insert({
            source: "imap",
            from_email: fromAddress,
            recipient,
            subject,
            result: "matched",
            job_id: job.id,
            assigned_to: assignedTo,
            is_opt_out: isOptOut,
          });

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
    const errorMessage = `IMAP-Verbindungsfehler: ${(err as Error).message}`;
    await adminSb.from("inbound_sync_state").upsert({
      channel: "imap",
      last_run_at: startedAt,
      last_error: errorMessage,
    });
    return {
      ok: false,
      configured: true,
      messagesChecked,
      repliesFound,
      optedOutFound,
      errors,
      errorMessage,
    };
  }

  // Success — update sync state
  await adminSb.from("inbound_sync_state").upsert({
    channel: "imap",
    last_run_at: startedAt,
    last_success_at: new Date().toISOString(),
    last_error: null,
    messages_checked: messagesChecked,
    replies_found: repliesFound,
    opt_outs_found: optedOutFound,
  });

  return {
    ok: true,
    configured: true,
    messagesChecked,
    repliesFound,
    optedOutFound,
    errors: errors.slice(0, 5),
  };
}
