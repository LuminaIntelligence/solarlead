import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/leads/follow-ups
 *
 * Liefert alle Leads mit Status=follow_up die heute oder in der
 * Vergangenheit (= überfällig) fällig sind. Role-Scope wird angewandt:
 * Field-Member sieht nur eigene + zugewiesene.
 *
 * Response: { today: Lead[], overdue: Lead[] }
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: settings } = await supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const role = (settings?.role as string) ?? "user";
    const mustScope = role === "user" || !role;

    const today = new Date().toISOString().slice(0, 10);

    let q = supabase
      .from("solar_lead_mass")
      .select("id, company_name, city, category, next_contact_date, total_score")
      .eq("status", "follow_up")
      .not("next_contact_date", "is", null)
      .lte("next_contact_date", today)
      .order("next_contact_date", { ascending: true });

    if (mustScope) {
      q = q.or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const todayList: typeof data = [];
    const overdueList: typeof data = [];
    for (const lead of data ?? []) {
      if (lead.next_contact_date === today) todayList.push(lead);
      else overdueList.push(lead);
    }

    return NextResponse.json({ today: todayList, overdue: overdueList });
  } catch {
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
