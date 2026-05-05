/**
 * GET /api/cron/imap-sync
 *
 * Wird alle 10 Minuten von GitHub Actions (.github/workflows/imap-sync.yml)
 * aufgerufen. Pollt das konfigurierte IMAP-Postfach, matcht eingehende
 * Mails gegen outreach_jobs und routet Replies ans Reply-Team.
 *
 * Secured via CRON_SECRET env var.
 *
 * Wenn IMAP nicht konfiguriert ist, returned 200 mit `skipped: true` —
 * sodass Cron-Jobs nicht failen und alarmieren, wenn das System auf
 * Mailgun-Webhook-Only-Mode umgestellt wird.
 */

import { NextRequest, NextResponse } from "next/server";
import { runImapSync, isImapConfigured } from "@/lib/team/imap-sync";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isImapConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "IMAP not configured (Mailgun-only mode)",
    });
  }

  const result = await runImapSync();

  console.log("[cron/imap-sync]", {
    ok: result.ok,
    messagesChecked: result.messagesChecked,
    repliesFound: result.repliesFound,
    optedOutFound: result.optedOutFound,
    errors: result.errors.length,
    error: result.errorMessage,
  });

  return NextResponse.json({
    ok: result.ok,
    messagesChecked: result.messagesChecked,
    repliesFound: result.repliesFound,
    optedOutFound: result.optedOutFound,
    errors: result.errors,
    error: result.errorMessage,
  });
}
