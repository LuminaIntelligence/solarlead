/**
 * POST /api/admin/leads/assign
 *
 * Weist Leads einem Nutzer zu (oder hebt Zuweisung auf).
 * Body: { leadIds: string[], assignedTo: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function isAdmin(u: { user_metadata?: { role?: string } } | null) {
  return u?.user_metadata?.role === "admin";
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user))
    return NextResponse.json({ error: "Keine Admin-Berechtigung" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const leadIds: string[] = body?.leadIds ?? [];
  const assignedTo: string | null = body?.assignedTo ?? null;

  if (!leadIds.length)
    return NextResponse.json({ error: "Keine Lead-IDs angegeben" }, { status: 400 });

  // Wenn assignedTo gesetzt, prüfen ob Nutzer existiert
  if (assignedTo) {
    const admin = createAdminClient();
    const { data: targetUser, error } = await admin.auth.admin.getUserById(assignedTo);
    if (error || !targetUser?.user)
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("solar_lead_mass")
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .in("id", leadIds);

  if (error) {
    console.error("[Assign] DB-Fehler:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    assigned: leadIds.length,
    assignedTo,
  });
}
