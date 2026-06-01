/**
 * GET /api/cron/linkedin-no-reply-sweep
 *
 * Daily-Cron. Markiert LinkedIn-Jobs die ≥ NO_REPLY_AFTER_DAYS Tage
 * 'sent' sind ohne dass je eine Antwort vermerkt wurde, als
 * outcome='no_reply'. Das räumt die UI auf — Lead bleibt in DB,
 * Job verschwindet aus dem aktiven Workflow.
 *
 * Idempotent: betroffene Jobs haben outcome IS NULL → werden nur einmal angefasst.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_REPLY_AFTER_DAYS = 14;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  if (req.headers.get("x-cron-secret") === expected) return true;
  if (req.nextUrl.searchParams.get("secret") === expected) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createAdminClient();
  const cutoff = new Date(
    Date.now() - NO_REPLY_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = new Date().toISOString();

  const { data: expired, error } = await sb
    .from("outreach_jobs")
    .update({
      outcome: "no_reply",
      outcome_at: now,
      updated_at: now,
    })
    .eq("channel", "linkedin")
    .eq("status", "sent")
    .is("outcome", null)
    .lt("linkedin_sent_at", cutoff)
    .select("id");

  if (error) {
    console.error("[linkedin-no-reply-sweep] DB-Fehler:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const expiredCount = expired?.length ?? 0;
  console.log(
    `[linkedin-no-reply-sweep] Cutoff ${cutoff} (${NO_REPLY_AFTER_DAYS}d) → ${expiredCount} Jobs auf outcome='no_reply'`
  );

  return NextResponse.json({
    ok: true,
    cutoff_iso: cutoff,
    cutoff_days: NO_REPLY_AFTER_DAYS,
    expired_count: expiredCount,
  });
}
