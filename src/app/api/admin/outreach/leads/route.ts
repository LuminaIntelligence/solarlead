import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

// Seniority priority mapping — lower number = higher priority
const SENIORITY_RANK: Record<string, number> = {
  c_suite: 1,
  vp: 2,
  director: 3,
  manager: 4,
  senior: 5,
  entry: 6,
  training: 7,
};

// Title keyword priority (checked in lowercase)
const TITLE_KEYWORDS_RANK: Array<{ keyword: string; rank: number }> = [
  { keyword: "geschäftsführer", rank: 1 },
  { keyword: "ceo", rank: 1 },
  { keyword: "inhaber", rank: 2 },
  { keyword: "owner", rank: 2 },
  { keyword: "vorstand", rank: 3 },
  { keyword: "direktor", rank: 4 },
  { keyword: "leiter", rank: 5 },
  { keyword: "manager", rank: 6 },
];

function getContactPriority(contact: {
  seniority: string | null;
  title: string | null;
}): number {
  // First check title keywords
  const titleLower = (contact.title ?? "").toLowerCase();
  for (const { keyword, rank } of TITLE_KEYWORDS_RANK) {
    if (titleLower.includes(keyword)) return rank;
  }
  // Fallback to seniority
  return SENIORITY_RANK[contact.seniority ?? ""] ?? 99;
}

// GET: find leads suitable for outreach
export async function GET(request: NextRequest) {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { supabase } = gate;

    const { searchParams } = new URL(request.url);
    const minScore = parseInt(searchParams.get("minScore") ?? "60", 10);
    const statusParam = searchParams.get("status") ?? "new,reviewed";
    const category = searchParams.get("category") ?? "";

    const statusList = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Query leads with score filter and status filter
    let leadsQuery = supabase
      .from("solar_lead_mass")
      .select("id, company_name, city, category, total_score, status")
      .gte("total_score", minScore)
      .order("total_score", { ascending: false })
      .limit(500);

    if (statusList.length > 0) {
      leadsQuery = leadsQuery.in("status", statusList);
    }
    if (category) {
      leadsQuery = leadsQuery.eq("category", category);
    }
    // Exclude leads claimed by any user — they belong to individual sales reps
    leadsQuery = leadsQuery.is("claimed_by", null);

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      if (
        leadsError.code === "42P01" ||
        leadsError.message?.includes("does not exist")
      ) {
        return NextResponse.json({
          leads: [],
          warning: "Tabelle solar_lead_mass nicht gefunden.",
        });
      }
      console.error("Fehler beim Abrufen der Leads:", leadsError.message);
      return NextResponse.json(
        { error: "Leads konnten nicht abgerufen werden" },
        { status: 500 }
      );
    }

    if (!leads || leads.length === 0) {
      return NextResponse.json({ leads: [] });
    }

    const leadIds = leads.map((l) => l.id);

    // Fetch contacts for these leads (only those with a non-null email)
    const { data: contacts, error: contactsError } = await supabase
      .from("lead_contacts")
      .select("id, lead_id, name, title, email, seniority")
      .in("lead_id", leadIds)
      .not("email", "is", null);

    if (contactsError) {
      if (
        contactsError.code === "42P01" ||
        contactsError.message?.includes("does not exist")
      ) {
        return NextResponse.json({
          leads: [],
          warning: "Tabelle lead_contacts nicht gefunden.",
        });
      }
      console.error("Fehler beim Abrufen der Kontakte:", contactsError.message);
      return NextResponse.json(
        { error: "Kontakte konnten nicht abgerufen werden" },
        { status: 500 }
      );
    }

    // Build a map of lead_id -> best contact
    const contactsByLead: Record<
      string,
      {
        id: string;
        lead_id: string;
        name: string;
        title: string | null;
        email: string;
        seniority: string | null;
      }
    > = {};

    for (const contact of contacts ?? []) {
      if (!contact.email) continue;

      const existing = contactsByLead[contact.lead_id];
      if (!existing) {
        contactsByLead[contact.lead_id] = contact as typeof contactsByLead[string];
      } else {
        const newPriority = getContactPriority(contact);
        const existingPriority = getContactPriority(existing);
        if (newPriority < existingPriority) {
          contactsByLead[contact.lead_id] = contact as typeof contactsByLead[string];
        }
      }
    }

    // Only return leads that have at least one contact with email
    const result = leads
      .filter((lead) => contactsByLead[lead.id])
      .map((lead) => {
        const contact = contactsByLead[lead.id];
        return {
          id: lead.id,
          company_name: lead.company_name,
          city: lead.city,
          category: lead.category,
          total_score: lead.total_score,
          status: lead.status,
          best_contact: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            title: contact.title,
            seniority: contact.seniority,
          },
        };
      });

    return NextResponse.json({ leads: result });
  } catch (err) {
    console.error("Outreach Leads GET fehlgeschlagen:", err);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
