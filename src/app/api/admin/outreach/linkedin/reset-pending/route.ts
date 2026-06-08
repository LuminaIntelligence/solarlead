/**
 * POST /api/admin/outreach/linkedin/reset-pending
 *
 * Setzt den LinkedIn-Outreach-Pool auf null zurück: alle offenen
 * (status='pending') LinkedIn-Jobs werden auf 'cancelled' gesetzt.
 *
 * NICHT angefasst werden:
 *   - sent (InMail wurde schon geschickt — kann nicht zurückgerollt werden)
 *   - replied (echte Antwort, dem Reply-Team zugewiesen)
 *   - cancelled (war schon stoniert)
 *
 * Idempotent: doppelter Aufruf führt zu 0 weiteren Stornierungen.
 *
 * Use Case: User möchte komplett neu starten und alle aktuellen pending
 * Jobs löschen (z.B. weil zu viele unpassende Leads drin sind).
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const sb = createAdminClient();
  const now = new Date().toISOString();

  // Erstmal Count holen für die Response
  const { count: pendingCount } = await sb
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .eq("channel", "linkedin")
    .eq("status", "pending");

  if (!pendingCount || pendingCount === 0) {
    return NextResponse.json({
      ok: true,
      cancelled: 0,
      message: "Keine offenen LinkedIn-Jobs vorhanden.",
    });
  }

  // Bulk-Cancel
  const { data: rows, error } = await sb
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      followup_status: "skipped",
      updated_at: now,
    })
    .eq("channel", "linkedin")
    .eq("status", "pending")
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cancelled = rows?.length ?? 0;
  console.log(
    `[linkedin/reset-pending] ${cancelled} pending LinkedIn-Jobs auf cancelled gesetzt`
  );

  return NextResponse.json({
    ok: true,
    cancelled,
  });
}

// GET: nur Count für die Vor-Bestätigung in der UI
export async function GET(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const sb = createAdminClient();
  const { count } = await sb
    .from("outreach_jobs")
    .select("id", { count: "exact", head: true })
    .eq("channel", "linkedin")
    .eq("status", "pending");

  return NextResponse.json({ pending_count: count ?? 0 });
}
