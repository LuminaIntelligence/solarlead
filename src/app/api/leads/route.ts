import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/actions/settings";
import { calculateScore } from "@/lib/scoring";
import { checkLeadDuplicate } from "@/lib/actions/leads";
import type { Lead } from "@/types/database";

const CreateLeadSchema = z.object({
  company_name: z.string().min(1),
  category: z.string().min(1),
  address: z.string().min(1),
  city: z.string(),
  postal_code: z.string().nullable().optional(),
  country: z.string().default("DE"),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  place_id: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  source: z.enum(["google_places", "csv_import", "manual"]).default("manual"),
});

// POST /api/leads  → Neuen Lead manuell erstellen
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
    const parsed = CreateLeadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Daten", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Duplikat-Check: falls die Firma in dieser Stadt/PLZ (oder mit dieser
    // place_id) schon existiert, KEIN neuer Lead — sondern Hinweis mit
    // Info wem der Lead aktuell gehört.
    const dup = await checkLeadDuplicate({
      place_id: input.place_id ?? null,
      company_name: input.company_name,
      postal_code: input.postal_code ?? null,
      city: input.city,
    });
    if (dup) {
      return NextResponse.json(
        {
          error: dup.is_own
            ? `Diese Firma hast du bereits erfasst: "${dup.company_name}".`
            : `Diese Firma ist bereits im System${dup.assigned_to_email ? ` und ${dup.assigned_to_email} zugewiesen` : ""}: "${dup.company_name}".`,
          duplicate: dup,
        },
        { status: 409 }
      );
    }

    const settings = await getUserSettings();
    const weights = settings?.scoring_weights ?? undefined;

    const scoring = calculateScore(
      {
        category: input.category,
        hasWebsite: !!input.website,
        hasPhone: !!input.phone,
        hasEmail: !!input.email,
      },
      weights
    );

    const lead: Omit<Lead, "id" | "created_at" | "updated_at"> & {
      assigned_to: string;
    } = {
      user_id: user.id,
      assigned_to: user.id, // Field-Member ist gleichzeitig Owner UND Assignee
      company_name: input.company_name,
      category: input.category,
      address: input.address,
      city: input.city,
      postal_code: input.postal_code ?? null,
      country: input.country,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      place_id: input.place_id ?? null,
      website: input.website ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      source: input.source,
      business_score: scoring.business_score,
      electricity_score: scoring.electricity_score,
      outreach_score: scoring.outreach_score,
      solar_score: scoring.solar_score,
      total_score: scoring.total_score,
      status: "new",
      notes: null,
      linkedin_url: null,
    };

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .insert(lead)
      .select()
      .single();

    if (error) {
      console.error("[POST /api/leads] DB error:", error);
      return NextResponse.json(
        { error: "Lead konnte nicht gespeichert werden" },
        { status: 500 }
      );
    }

    return NextResponse.json(data as Lead, { status: 201 });
  } catch (error) {
    console.error("[POST /api/leads] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
