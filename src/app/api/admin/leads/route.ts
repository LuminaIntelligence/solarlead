import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

export async function GET(request: NextRequest) {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { adminSupabase: adminClient } = gate;

    // Query-Parameter auslesen
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const category = searchParams.get("category") || "";
    const solarComplete = searchParams.get("solar_complete") === "1";

    // If filtering by complete solar data: get lead_ids from solar_assessments first
    let solarCompleteIds: Set<string> | null = null;
    if (solarComplete) {
      const { data: completeAssessments } = await adminClient
        .from("solar_assessments")
        .select("lead_id")
        .not("max_array_panels_count", "is", null);
      solarCompleteIds = new Set((completeAssessments ?? []).map((a) => a.lead_id));
    }

    // Count archived (existing_solar) leads separately — always, regardless of filters
    const { count: archivedCount } = await adminClient
      .from("solar_lead_mass")
      .select("id", { count: "exact", head: true })
      .eq("status", "existing_solar");

    // Leads abfragen
    let query = adminClient
      .from("solar_lead_mass")
      .select("*")
      .order("total_score", { ascending: false })
      .limit(500);

    if (status) {
      // Explicit status filter — show exactly what was requested (incl. existing_solar)
      query = query.eq("status", status);
    } else {
      // Default: hide archived leads from main list
      query = query.neq("status", "existing_solar");
    }
    if (category) {
      query = query.eq("category", category);
    }
    if (search) {
      query = query.or(
        `company_name.ilike.%${search}%,city.ilike.%${search}%`
      );
    }

    const { data: leadsRaw, error: leadsError } = await query;
    const leads = solarCompleteIds
      ? (leadsRaw ?? []).filter((l) => solarCompleteIds!.has(l.id))
      : leadsRaw;

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

    // Leads mit Besitzer- und Zuweisung-E-Mail anreichern
    const enrichedLeads = (leads ?? []).map((lead) => ({
      ...lead,
      owner_email: emailMap[lead.user_id] ?? "Unbekannt",
      assigned_email: lead.assigned_to ? (emailMap[lead.assigned_to] ?? "Unbekannt") : null,
    }));

    return NextResponse.json({ leads: enrichedLeads, archivedCount: archivedCount ?? 0 });
  } catch (err) {
    console.error("Admin-Leads-API fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
