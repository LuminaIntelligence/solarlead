import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/actions/settings";
import { getContactProvider } from "@/lib/providers/contacts";

const ContactRequestSchema = z.object({
  lead_id: z.string().uuid(),
  domain: z.string().min(3),
  company_name: z.string().min(1),
  city: z.string().optional(),
});

/**
 * Extrahiert die Domain aus einer Website-URL
 * "https://www.muellerlogistik.de/kontakt" → "muellerlogistik.de"
 */
function extractDomain(input: string): string {
  try {
    const url = input.includes("://") ? input : `https://${input}`;
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return input.replace(/^www\./, "").split("/")[0];
  }
}

// POST /api/contacts  → Kontakte für einen Lead suchen + speichern
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ContactRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Anfrage", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { lead_id, domain, company_name, city } = parsed.data;
    const cleanDomain = extractDomain(domain);

    // Lead gehört dem Nutzer?
    const { data: lead, error: leadError } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
    }

    // Settings + Provider
    const settings = await getUserSettings();
    const mode = settings?.provider_mode ?? "mock";
    const apolloKey = process.env.APOLLO_API_KEY ?? undefined;
    const provider = getContactProvider(mode, apolloKey);

    // Apollo / Mock aufrufen
    const result = await provider.findContacts({
      domain: cleanDomain,
      company_name,
      city,
    });

    // Alte Kontakte für diesen Lead löschen (Neusuche überschreibt)
    await supabase
      .from("lead_contacts")
      .delete()
      .eq("lead_id", lead_id)
      .eq("user_id", user.id);

    // Neue Kontakte speichern
    if (result.contacts.length > 0) {
      const rows = result.contacts.map((c) => ({
        lead_id,
        user_id: user.id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        linkedin_url: c.linkedin_url,
        apollo_id: c.apollo_id,
        seniority: c.seniority,
        department: c.department,
        source: provider.name,
      }));

      const { error: insertError } = await supabase
        .from("lead_contacts")
        .insert(rows);

      if (insertError) {
        console.error("[contacts] Insert error:", insertError);
      }
    }

    // Firmographics + LinkedIn-URL in den Lead zurückschreiben
    const leadUpdates: Record<string, unknown> = {};
    if (result.company?.estimated_num_employees) {
      leadUpdates.employee_count = result.company.estimated_num_employees;
    }
    if (result.company?.linkedin_url) {
      leadUpdates.linkedin_url = result.company.linkedin_url;
    }
    if (Object.keys(leadUpdates).length > 0) {
      await supabase
        .from("solar_lead_mass")
        .update(leadUpdates)
        .eq("id", lead_id)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      contacts: result.contacts,
      company: result.company,
      domain: cleanDomain,
      provider: provider.name,
    });
  } catch (error) {
    console.error("[POST /api/contacts] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

// GET /api/contacts?lead_id=...  → Gespeicherte Kontakte laden
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lead_id = request.nextUrl.searchParams.get("lead_id");
    if (!lead_id) {
      return NextResponse.json({ error: "lead_id erforderlich" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("lead_contacts")
      .select("*")
      .eq("lead_id", lead_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("[GET /api/contacts] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
