import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    // Admin-Berechtigung pruefen
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Nicht authentifiziert" },
        { status: 401 }
      );
    }

    if (user.user_metadata?.role !== "admin") {
      return NextResponse.json(
        { error: "Keine Admin-Berechtigung" },
        { status: 403 }
      );
    }

    const adminClient = createAdminClient();

    // Query-Parameter auslesen
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const category = searchParams.get("category") || "";

    // Leads abfragen
    let query = adminClient
      .from("solar_lead_mass")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status) {
      query = query.eq("status", status);
    }
    if (category) {
      query = query.eq("category", category);
    }
    if (search) {
      query = query.or(
        `company_name.ilike.%${search}%,city.ilike.%${search}%`
      );
    }

    const { data: leads, error: leadsError } = await query;

    if (leadsError) {
      console.error("Fehler beim Abrufen der Leads:", leadsError.message);
      return NextResponse.json(
        { error: "Leads konnten nicht abgerufen werden" },
        { status: 500 }
      );
    }

    // Benutzer-E-Mails abrufen
    const {
      data: { users },
      error: usersError,
    } = await adminClient.auth.admin.listUsers();

    if (usersError) {
      console.error("Fehler beim Abrufen der Benutzer:", usersError.message);
    }

    // E-Mail-Map erstellen
    const emailMap: Record<string, string> = {};
    if (users) {
      for (const u of users) {
        emailMap[u.id] = u.email ?? "Unbekannt";
      }
    }

    // Leads mit Besitzer-E-Mail anreichern
    const enrichedLeads = (leads ?? []).map((lead) => ({
      ...lead,
      owner_email: emailMap[lead.user_id] ?? "Unbekannt",
    }));

    return NextResponse.json({ leads: enrichedLeads });
  } catch (err) {
    console.error("Admin-Leads-API fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
