/**
 * GET /api/admin/users
 * Gibt alle Nutzer zurück (id + email) — für Zuweisungs-Dialoge.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin")
    return NextResponse.json({ error: "Keine Admin-Berechtigung" }, { status: 403 });

  const admin = createAdminClient();
  const { data: { users }, error } = await admin.auth.admin.listUsers();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    users: (users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: u.user_metadata?.role ?? "user",
    })),
  });
}
