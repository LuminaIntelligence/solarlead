/**
 * Hourly cron — handles auto-assignment safety net + reminder digest.
 *
 * Triggered by system cron every hour:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/team-tick
 *
 * Per tick:
 *   1. autoAssignAllPending — picks up replies that slipped past sync-replies
 *      (e.g. from Mailgun webhook before this feature was deployed).
 *   2. Optional: reminder emails to specialists with overdue/due-today tasks.
 *      Dedup: max 1 reminder mail per user per 4h.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignAllPending } from "@/lib/team/auto-assign";
import { recordHealth, sendAlertIfFresh } from "@/lib/discovery/health-tracker";
import { sendEmail } from "@/lib/providers/email/mailgun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  if (req.headers.get("x-cron-secret") === expected) return true;
  if (req.nextUrl.searchParams.get("secret") === expected) return true;
  return false;
}

const ACTIVE = ["new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold"];

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const startedAt = Date.now();

  await recordHealth(adminSupabase, {
    source: "team_tick",
    kind: "heartbeat",
    message: "team-tick started",
  });

  // 1. Auto-assign safety net
  const assign = await autoAssignAllPending(adminSupabase);
  if (assign.noSpecialists && assign.processed > 0) {
    // Alert admin: replies are piling up but no team exists
    await sendAlertIfFresh(
      adminSupabase,
      "team_no_specialists",
      "Replies im Pool ohne Team-Mitglieder",
      `${assign.processed} Reply${assign.processed === 1 ? "" : "s"} sind im Pool, aber es gibt keine reply_specialist oder team_lead User.\n\n` +
        `Bitte mindestens einen User auf role='reply_specialist' setzen, sonst werden eingehende Replies nicht abgearbeitet.`,
      { pool_size: assign.processed }
    );
  }

  // 2. Reminder digest — for each user with overdue or due-today tasks,
  //    send max 1 mail per 4 hours.
  const fourHrsAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const { data: dueRows } = await adminSupabase
    .from("outreach_jobs")
    .select("assigned_to, next_action_at, company_name")
    .not("assigned_to", "is", null)
    .lte("next_action_at", endOfToday.toISOString())
    .in("outcome", ACTIVE);

  // Group by user
  const byUser = new Map<string, typeof dueRows>();
  for (const r of dueRows ?? []) {
    if (!r.assigned_to) continue;
    const list = byUser.get(r.assigned_to as string) ?? [];
    list.push(r);
    byUser.set(r.assigned_to as string, list);
  }

  let reminderMailsSent = 0;
  for (const [userId, jobs] of byUser) {
    if (!jobs?.length) continue;
    // Dedup: was a reminder already sent in the last 4h?
    const { data: recent } = await adminSupabase
      .from("system_health_events")
      .select("id")
      .eq("kind", "alert_sent")
      .filter("context->>alert_kind", "eq", `team_reminder_${userId}`)
      .gte("ts", fourHrsAgo)
      .limit(1)
      .maybeSingle();
    if (recent) continue;

    // Get email
    const { data: { user } } = await adminSupabase.auth.admin.getUserById(userId);
    const email = user?.email;
    if (!email) continue;

    const overdue = jobs.filter((j) => j.next_action_at && new Date(j.next_action_at as string) < now);
    const today = jobs.filter((j) => j.next_action_at && new Date(j.next_action_at as string) >= now);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
    const mailRes = await sendEmail({
      to: email,
      subject: `[SolarLead] ${overdue.length > 0 ? `🔴 ${overdue.length} überfällig · ` : ""}${today.length} heute fällig`,
      text: buildReminderText(overdue, today, baseUrl),
      html: buildReminderHtml(overdue, today, baseUrl),
      "o:tag": ["team_reminder"],
    });

    if (mailRes) {
      reminderMailsSent++;
      await recordHealth(adminSupabase, {
        source: "team_tick",
        kind: "alert_sent",
        message: `Reminder-Mail an ${email}: ${overdue.length} überfällig, ${today.length} heute`,
        context: { alert_kind: `team_reminder_${userId}`, user_id: userId, overdue: overdue.length, today: today.length },
      });
    }
  }

  await recordHealth(adminSupabase, {
    source: "team_tick",
    kind: "heartbeat",
    message: `team-tick: assigned ${assign.assigned}/${assign.processed}, reminder mails ${reminderMailsSent}`,
    context: { assigned: assign.assigned, processed: assign.processed, mails: reminderMailsSent, elapsed_ms: Date.now() - startedAt },
  });

  return NextResponse.json({
    ok: true,
    assigned: assign.assigned,
    poolProcessed: assign.processed,
    reminderMailsSent,
    elapsedMs: Date.now() - startedAt,
  });
}

interface DueJob { company_name: string | null; next_action_at: string | null }

function buildReminderText(overdue: DueJob[], today: DueJob[], baseUrl: string): string {
  const lines: string[] = ["Hallo,", ""];
  if (overdue.length) {
    lines.push(`🔴 ÜBERFÄLLIG (${overdue.length}):`);
    for (const j of overdue) {
      lines.push(`  • ${j.company_name ?? "?"} — fällig: ${j.next_action_at ? new Date(j.next_action_at).toLocaleString("de-DE") : "?"}`);
    }
    lines.push("");
  }
  if (today.length) {
    lines.push(`📅 HEUTE FÄLLIG (${today.length}):`);
    for (const j of today) {
      lines.push(`  • ${j.company_name ?? "?"} — ${j.next_action_at ? new Date(j.next_action_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "?"}`);
    }
    lines.push("");
  }
  lines.push(`Inbox: ${baseUrl}/team/inbox`);
  return lines.join("\n");
}

function buildReminderHtml(overdue: DueJob[], today: DueJob[], baseUrl: string): string {
  const item = (j: DueJob, urgent: boolean) =>
    `<li style="margin-bottom: 4px;"><strong>${j.company_name ?? "?"}</strong> — <span style="color:${urgent ? "#dc2626" : "#64748b"}">${j.next_action_at ? new Date(j.next_action_at).toLocaleString("de-DE") : "?"}</span></li>`;
  return `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2>SolarLead — deine Tasks</h2>
      ${overdue.length ? `<h3 style="color:#dc2626;">🔴 Überfällig (${overdue.length})</h3><ul>${overdue.map((j) => item(j, true)).join("")}</ul>` : ""}
      ${today.length ? `<h3 style="color:#d97706;">📅 Heute fällig (${today.length})</h3><ul>${today.map((j) => item(j, false)).join("")}</ul>` : ""}
      <p style="margin-top:24px;"><a href="${baseUrl}/team/inbox" style="background:#2563eb;color:white;padding:8px 16px;text-decoration:none;border-radius:4px;">→ Zur Inbox</a></p>
    </div>
  `.trim();
}
