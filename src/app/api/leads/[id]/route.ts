import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const UpdateLeadSchema = z.object({
  company_name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postal_code: z.string().nullable().optional(),
  status: z.enum(["new", "reviewed", "contacted", "qualified", "rejected", "existing_solar"]).optional(),
  notes: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  deal_value: z.number().nullable().optional(),
  next_contact_date: z.string().nullable().optional(),
  win_probability: z.number().min(0).max(100).nullable().optional(),
});

// PATCH /api/leads/[id]  → Lead-Felder aktualisieren
//
// Team-Modell: JEDER authentifizierte Nutzer mit einer Team-Rolle darf
// Lead-Daten (insbesondere Notizen, Status, CRM-Felder) editieren — nicht
// nur der ursprüngliche Lead-Owner (user_id). Damit Reply-Specialists
// (Helena & Co.) auch Notizen an Leads schreiben können, die ein Admin
// per Discovery angelegt hat. Wer geändert hat steht in last_edited_by.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const body = await request.json();
    const parsed = UpdateLeadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Daten", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Existenz-Check (kein Owner-Check mehr — Team-weite Bearbeitung)
    const { data: existing, error: fetchError } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
    }

    // Track WHO edited and WHEN. Die DB-Spalten existieren ab Migration
    // 20260505_user_edit_tracking. Fallback wenn nicht vorhanden.
    const updatePayload = {
      ...parsed.data,
      last_edited_by: user.id,
      last_edited_at: new Date().toISOString(),
    };

    let { data, error } = await supabase
      .from("solar_lead_mass")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    // Fallback: if the audit columns don't exist (migration pending), retry
    // with just the user-provided fields so editing isn't blocked.
    if (error && error.message?.includes("last_edited_")) {
      console.warn("[PATCH /api/leads/[id]] audit columns missing, retrying without them");
      const retry = await supabase
        .from("solar_lead_mass")
        .update(parsed.data)
        .eq("id", id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error("[PATCH /api/leads/[id]] DB error:", error);
      return NextResponse.json(
        { error: "Aktualisierung fehlgeschlagen" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[PATCH /api/leads/[id]] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

// DELETE /api/leads/[id]  → Lead löschen
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const { error } = await supabase
      .from("solar_lead_mass")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("[DELETE /api/leads/[id]] DB error:", error);
      return NextResponse.json(
        { error: "Löschen fehlgeschlagen" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/leads/[id]] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
