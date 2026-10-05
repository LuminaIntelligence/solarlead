import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Role-Scope: Field-Member (role='user') sieht eigene + zugewiesene Leads.
    // Admin/team_lead/reply_specialist sehen alles.
    const { data: settings } = await supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = (settings?.role as string) ?? "user";
    const mustScope = role === "user" || !role;

    // EGRESS-GUARD: Nie mehr als 2000 Pins ausliefern.
    // Admin sieht Top-Score-Leads (sortiert nach total_score DESC),
    // Field-Member bekommt sowieso nur eigene+zugewiesene (<~2000).
    // 2000 Pins × ~270 Byte = ~550 KB statt 32 MB.
    const MAX_PINS = 2000;

    let query = supabase
      .from("solar_lead_mass")
      .select("id, company_name, category, city, address, latitude, longitude, total_score, status, solar_score")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      // Archivierte Leads nicht auf die Karte (sparen Egress + irrelevant)
      .neq("status", "existing_solar");

    if (mustScope) {
      query = query.or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`);
    }

    const { data, error } = await query
      .order("total_score", { ascending: false })
      .limit(MAX_PINS);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
