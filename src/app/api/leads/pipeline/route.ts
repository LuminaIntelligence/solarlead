import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Rolle prüfen — privilegierte Rollen sehen alle Leads,
    // Field-Member (role='user') nur eigene + zugewiesene.
    const { data: settings } = await supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = (settings?.role as string | undefined) ?? "user";
    const mustScope = !["admin", "team_lead", "reply_specialist"].includes(role);

    let q = supabase
      .from("solar_lead_mass")
      .select("id, company_name, category, city, total_score, status, next_contact_date, win_probability")
      .order("total_score", { ascending: false });
    if (mustScope) {
      q = q.or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`);
    }
    const { data, error } = await q;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
