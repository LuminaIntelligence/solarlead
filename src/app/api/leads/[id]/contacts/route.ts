/**
 * Per-lead contact CRUD — for users who want to add contacts manually
 * (e.g. someone they met at an event, or a referral).
 *
 * POST /api/leads/[id]/contacts
 *   Body: { name, title?, email?, phone?, linkedin_url?, seniority?, department? }
 *   → Inserts a single contact with source='manual'.
 *
 * GET /api/leads/[id]/contacts
 *   → Returns all contacts for this lead, ordered by is_primary first then by created_at desc.
 *
 * Ownership is enforced via the existing solar_lead_mass.user_id check —
 * users can only modify contacts of leads they own.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ContactSchema = z.object({
  name: z.string().min(1, "Name ist erforderlich").max(200),
  title: z.string().nullable().optional(),
  email: z.string().email("Ungültige E-Mail").nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
});

async function ownsLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("solar_lead_mass")
    .select("id")
    .eq("id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  if (!await ownsLead(supabase, leadId, user.id)) {
    return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("lead_contacts")
    .select("*")
    .eq("lead_id", leadId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  if (!await ownsLead(supabase, leadId, user.id)) {
    return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Daten", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Normalize empty strings to null
  const norm = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v])
  );

  const insertPayload = {
    lead_id: leadId,
    user_id: user.id,
    source: "manual",
    is_primary: false,
    last_edited_by: user.id,
    last_edited_at: new Date().toISOString(),
    ...norm,
  };

  // Insert with audit columns first; fall back if the migration hasn't applied yet.
  let { data, error } = await supabase
    .from("lead_contacts")
    .insert(insertPayload)
    .select()
    .single();

  if (error && (error.message?.includes("is_primary") || error.message?.includes("last_edited_"))) {
    console.warn("[POST /api/leads/[id]/contacts] audit columns missing, retrying minimal insert");
    const retry = await supabase
      .from("lead_contacts")
      .insert({
        lead_id: leadId,
        user_id: user.id,
        source: "manual",
        ...norm,
      })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data }, { status: 201 });
}
