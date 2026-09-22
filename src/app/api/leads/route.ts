import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserSettings } from "@/lib/actions/settings";
import { calculateScore } from "@/lib/scoring";
import { checkLeadDuplicate } from "@/lib/actions/leads";
import { geocodeAddress } from "@/lib/providers/geocoding/nominatim";
import { getSolarProvider } from "@/lib/providers/solar";
import type { Lead } from "@/types/database";

/**
 * Solar-Assessment im Hintergrund für einen frisch angelegten Lead.
 *
 * Läuft asynchron nachdem der POST /api/leads Response schon rausging.
 * Nutzt den Service-Role Client damit die Owner-Prüfung übersprungen wird.
 * Bei Fehler: einfach loggen, kein Retry — der User kann den Assessment
 * später manuell nachziehen wenn Score fehlt.
 */
async function runSolarAssessmentInBackground(
  leadId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  try {
    const provider = getSolarProvider("live", process.env.GOOGLE_SOLAR_API_KEY);
    const result = await provider.assess({ latitude, longitude });
    if (!result) {
      console.warn(`[bg-solar] Lead ${leadId}: kein Assessment-Ergebnis`);
      return;
    }

    const admin = createAdminClient();

    // Assessment speichern
    const { error: aErr } = await admin.from("solar_assessments").insert({
      lead_id: leadId,
      provider: "google_solar",
      latitude,
      longitude,
      solar_quality: result.solar_quality ?? null,
      max_array_area_m2: result.max_array_area_m2 ?? null,
      max_array_panels_count: result.max_array_panels_count ?? null,
      annual_energy_kwh: result.annual_energy_kwh ?? null,
      sunshine_hours: result.sunshine_hours ?? null,
      carbon_offset: result.carbon_offset ?? null,
      segment_count: result.segment_count ?? null,
      panel_capacity_watts: result.panel_capacity_watts ?? null,
      raw_response_json: result.raw_response_json ?? null,
    });
    if (aErr) {
      console.error(`[bg-solar] Lead ${leadId}: assessment insert failed: ${aErr.message}`);
      return;
    }

    // Score neu berechnen mit Solar-Daten
    const { data: lead } = await admin
      .from("solar_lead_mass")
      .select("category, website, phone, email")
      .eq("id", leadId)
      .single();
    if (!lead) return;

    const scoring = calculateScore({
      category: lead.category,
      hasWebsite: !!lead.website,
      hasPhone: !!lead.phone,
      hasEmail: !!lead.email,
      solarData: {
        solar_quality: result.solar_quality,
        max_array_panels_count: result.max_array_panels_count,
        max_array_area_m2: result.max_array_area_m2,
        annual_energy_kwh: result.annual_energy_kwh,
      },
    });

    await admin
      .from("solar_lead_mass")
      .update({
        solar_score: scoring.solar_score,
        business_score: scoring.business_score,
        electricity_score: scoring.electricity_score,
        outreach_score: scoring.outreach_score,
        total_score: scoring.total_score,
      })
      .eq("id", leadId);

    console.log(
      `[bg-solar] Lead ${leadId}: Score ${scoring.total_score} (${result.max_array_area_m2 ?? "?"} m²)`
    );
  } catch (err) {
    console.error(`[bg-solar] Lead ${leadId}: unexpected error`, err);
  }
}

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

    // Auto-Geocoding + Solar-Assessment für manuell angelegte Leads
    // (nur wenn User keine Koordinaten mitgeliefert hat).
    // Geocoding ist sync (~1s), Solar-Assessment fire-and-forget im Hintergrund.
    let leadWithCoords = data as Lead;
    let geocodingResult: {
      ok: boolean;
      confidence?: string;
      error?: string;
    } = { ok: false };

    if (input.source === "manual" && !input.latitude && !input.longitude) {
      const geo = await geocodeAddress({
        street: input.address,
        postal_code: input.postal_code ?? null,
        city: input.city,
        country: input.country ?? "de",
      });

      if (geo.ok) {
        geocodingResult = { ok: true, confidence: geo.confidence };
        // Koordinaten am Lead speichern (Service-Role Client umgeht Owner-Filter)
        const admin = createAdminClient();
        const { data: updated } = await admin
          .from("solar_lead_mass")
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
          })
          .eq("id", data.id)
          .select()
          .single();
        if (updated) leadWithCoords = updated as Lead;

        // Fire-and-forget: Solar-Assessment im Hintergrund
        // (kein await — Response geht sofort an Frontend)
        void runSolarAssessmentInBackground(
          data.id,
          geo.latitude,
          geo.longitude
        ).catch((e) => {
          console.error("[POST /api/leads] Solar-Assessment failed:", e);
        });
      } else {
        geocodingResult = { ok: false, error: geo.error };
      }
    }

    return NextResponse.json(
      {
        ...leadWithCoords,
        geocoding: geocodingResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/leads] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
