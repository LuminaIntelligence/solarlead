import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateActivitySchema = z.object({
  lead_id: z.string().uuid(),
  type: z.enum(["call", "email", "meeting", "note", "task"]),
  subject: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  activity_date: z.string(),
  next_action: z.string().nullable().optional(),
  next_action_date: z.string().nullable().optional(),
});

// GET /api/activities?lead_id=... → Aktivitäten für Lead abrufen
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get("lead_id");

    if (!leadId) {
      return NextResponse.json(
        { error: "lead_id ist erforderlich" },
        { status: 400 }
      );
    }

    // Sicherstellen, dass der Lead dem Nutzer gehört
    const { data: lead, error: leadError } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("activity_date", { ascending: false });

    if (error) {
      console.error("[GET /api/activities] DB error:", error);
      return NextResponse.json(
        { error: "Abrufen fehlgeschlagen" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[GET /api/activities] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

// POST /api/activities → Aktivität erstellen
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
    const parsed = CreateActivitySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Daten", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Sicherstellen, dass der Lead dem Nutzer gehört
    const { data: lead, error: leadError } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .eq("id", parsed.data.lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("lead_activities")
      .insert({
        ...parsed.data,
        user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[POST /api/activities] DB error:", error);
      return NextResponse.json(
        { error: "Erstellen fehlgeschlagen" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("[POST /api/activities] error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
