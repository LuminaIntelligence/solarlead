import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .select("id, company_name, category, city, address, latitude, longitude, total_score, status, solar_score")
      .eq("user_id", user.id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("total_score", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
