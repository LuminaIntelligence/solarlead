/**
 * Daily digest cron — sends each team member their morning briefing.
 *
 * Triggered by system cron at 08:00 Mo-Fr:
 *   0 8 * * 1-5 curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/team-digest
 *
 * Per user (reply_specialist + team_lead + admin):
 *   - count of overdue + today's tasks
 *   - count of unread replies in pool (specialists only)
 *   - admin/lead get extra: yesterday's team activity, SLA violations
 *
 * Skips users with role='user' (regular CRM users, not on the team).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHealth } from "@/lib/discovery/health-tracker";
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";

  await recordHealth(adminSupabase, { source: "team_digest", kind: "heartbeat", message: "digest started" });

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const yesterdayStart = new Date(startOfToday); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const slaPoolThreshold = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const slaResponseThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // All team members
  const { data: teamUsers } = await adminSupabase
    .from("user_settings")
    .select("user_id, role")
    .in("role", ["reply_specialist", "team_lead", "admin"]);

  let mailsSent = 0;

  for (const member of teamUsers ?? []) {
    const userId = member.user_id as string;
    const role = member.role as string;
    const isLead = role === "team_lead" || role === "admin";

    const [overdueRes, todayRes, mineRes, poolRes, yesterdayWinsRes] = await Promise.all([
      adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
        .eq("assigned_to", userId).lt("next_action_at", now.toISOString()).in("outcome", ACTIVE),
      adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
        .eq("assigned_to", userId)
        .gte("next_action_at", startOfToday.toISOString())
        .lte("next_action_at", endOfToday.toISOString())
        .in("outcome", ACTIVE),
      adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
        .eq("assigned_to", userId).in("outcome", ACTIVE),
      adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
        .is("assigned_to", null).eq("status", "replied"),
      adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
        .eq("assigned_to", userId).eq("outcome", "closed_won")
        .gte("outcome_at", yesterdayStart.toISOString())
        .lt("outcome_at", startOfToday.toISOString()),
    ]);

    // SLA violations — admin/lead only
    let slaPool = 0, slaResponse = 0;
    if (isLead) {
      const [a, b] = await Promise.all([
        adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
          .is("assigned_to", null).eq("status", "replied")
          .lt("replied_at", slaPoolThreshold.toISOString()),
        adminSupabase.from("outreach_jobs").select("id", { count: "exact", head: true })
          .not("assigned_to", "is", null).in("outcome", ACTIVE)
          .lt("last_activity_at", slaResponseThreshold.toISOString()),
      ]);
      slaPool = a.count ?? 0;
      slaResponse = b.count ?? 0;
    }

    const overdue = overdueRes.count ?? 0;
    const today = todayRes.count ?? 0;
    const mine = mineRes.count ?? 0;
    const pool = poolRes.count ?? 0;
    const yesterdayWins = yesterdayWinsRes.count ?? 0;

    // Skip sending if user has nothing to act on (and is not a lead/admin)
    if (!isLead && overdue === 0 && today === 0 && mine === 0 && pool === 0) continue;

    const { data: { user } } = await adminSupabase.auth.admin.getUserById(userId);
    const email = user?.email;
    if (!email) continue;

    const subject = `[SolarLead] Briefing — ${overdue > 0 ? `🔴 ${overdue} überfällig · ` : ""}${today} heute · ${mine} offen${pool > 0 ? ` · ${pool} im Pool` : ""}`;

    const html = `
<div style="font-family: sans-serif; max-width: 640px;">
  <h2 style="color: #0f172a;">Guten Morgen ☕</h2>
  <p>Dein Briefing für heute:</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr>
      <td style="padding: 8px 12px; background: ${overdue > 0 ? "#fee2e2" : "#f1f5f9"}; border: 1px solid ${overdue > 0 ? "#fecaca" : "#e2e8f0"}; border-radius: 4px; width: 25%;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Überfällig</div>
        <div style="font-size: 24px; font-weight: bold; color: ${overdue > 0 ? "#991b1b" : "#0f172a"};">${overdue}</div>
      </td>
      <td style="padding: 8px 12px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 4px; width: 25%;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Heute fällig</div>
        <div style="font-size: 24px; font-weight: bold; color: #92400e;">${today}</div>
      </td>
      <td style="padding: 8px 12px; background: #dbeafe; border: 1px solid #bfdbfe; border-radius: 4px; width: 25%;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Offen total</div>
        <div style="font-size: 24px; font-weight: bold; color: #1e3a8a;">${mine}</div>
      </td>
      <td style="padding: 8px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; width: 25%;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Pool</div>
        <div style="font-size: 24px; font-weight: bold;">${pool}</div>
      </td>
    </tr>
  </table>
  ${yesterdayWins > 0 ? `<p style="background:#dcfce7;padding:8px 12px;border-radius:4px;color:#166534;">🎉 Gestern: <strong>${yesterdayWins} Win${yesterdayWins === 1 ? "" : "s"}</strong> — gute Arbeit!</p>` : ""}
  ${isLead && (slaPool > 0 || slaResponse > 0) ? `
  <div style="margin-top:16px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;">
    <h3 style="color:#991b1b;margin-top:0;">⚠ SLA-Verletzungen (nur als Lead sichtbar)</h3>
    ${slaPool > 0 ? `<p>${slaPool} Reply${slaPool === 1 ? "" : "s"} länger als 3h im Pool</p>` : ""}
    ${slaResponse > 0 ? `<p>${slaResponse} Reply${slaResponse === 1 ? "" : "s"} länger als 24h ohne Aktivität</p>` : ""}
  </div>` : ""}
  <p style="margin-top:24px;">
    <a href="${baseUrl}/team/inbox" style="background:#2563eb;color:white;padding:10px 18px;text-decoration:none;border-radius:4px;font-weight:500;">→ Zur Inbox</a>
  </p>
  <hr style="margin-top:32px;border:0;border-top:1px solid #e2e8f0;">
  <p style="font-size:11px;color:#94a3b8;">Briefing automatisch versendet · Werktags 08:00</p>
</div>`.trim();

    const text =
      `Guten Morgen,\n\nDein Briefing:\n` +
      `  Überfällig: ${overdue}\n  Heute fällig: ${today}\n  Offen: ${mine}\n  Pool: ${pool}\n` +
      (yesterdayWins > 0 ? `\n🎉 Gestern: ${yesterdayWins} Win${yesterdayWins === 1 ? "" : "s"}\n` : "") +
      (isLead && (slaPool > 0 || slaResponse > 0) ? `\nSLA-Verletzungen: Pool>3h: ${slaPool}, Response>24h: ${slaResponse}\n` : "") +
      `\nInbox: ${baseUrl}/team/inbox`;

    const mailRes = await sendEmail({
      to: email,
      subject,
      html,
      text,
      "o:tag": ["team_digest"],
    });

    if (mailRes) {
      mailsSent++;
      await recordHealth(adminSupabase, {
        source: "team_digest",
        kind: "info",
        message: `Digest an ${email} (overdue=${overdue}, today=${today})`,
        context: { user_id: userId, overdue, today, mine, pool },
      });
    }
  }

  await recordHealth(adminSupabase, {
    source: "team_digest",
    kind: "heartbeat",
    message: `digest done: ${mailsSent} mails`,
    context: { mails_sent: mailsSent, elapsed_ms: Date.now() - startedAt },
  });

  return NextResponse.json({ ok: true, mailsSent, elapsedMs: Date.now() - startedAt });
}
