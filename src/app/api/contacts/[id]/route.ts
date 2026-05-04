/**
 * Per-contact CRUD: edit a single contact, delete it, or toggle is_primary.
 *
 * PATCH /api/contacts/[id]
 *   Body: { name?, title?, email?, phone?, linkedin_url?, seniority?, department?, is_primary? }
 *   → If is_primary=true, the API also clears is_primary on all other contacts of the
 *     same lead (atomic-ish: 2 sequential updates inside one request).
 *
 * DELETE /api/contacts/[id]
 *   → Removes the contact. Ownership enforced via the linked lead's user_id.
 *
 * GET is not provided here — fetch via /api/leads/[id]/contacts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  title: z.string().nullable().optional(),
  email: z.string().email("Ungültige E-Mail").nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
});

/**
 * Returns the contact + parent lead's owner id, or null if either missing.
 * Uses the admin client because users may legitimately edit contacts on
 * leads they own, but the contact row's RLS may not always permit reads.
 */
async function fetchContactOwnership(contactId: string) {
  const adminSupabase = createAdminClient();
  const { data } = await adminSupabase
    .from("lead_contacts")
    .select("id, lead_id, solar_lead_mass:lead_id(user_id)")
    .eq("id", contactId)
    .maybeSingle();
  if (!data) return null;
  type Joined = { id: string; lead_id: string; solar_lead_mass: { user_id: string } | { user_id: string }[] | null };
  const joined = data as unknown as Joined;
  const ownerId = Array.isArray(joined.solar_lead_mass)
    ? joined.solar_lead_mass[0]?.user_id
    : joined.solar_lead_mass?.user_id;
  return { contactId: joined.id, leadId: joined.lead_id, ownerId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: contactId } = await params;

  const ownership = await fetchContactOwnership(contactId);
  if (!ownership) return NextResponse.json({ error: "Kontakt nicht gefunden" }, { status: 404 });
  if (ownership.ownerId !== user.id) {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Daten", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Normalize empty strings to null
  const fields = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v])
  );

  // If is_primary=true, clear it on all OTHER contacts of the same lead first.
  // Done via service-role client because the user may not have UPDATE on rows
  // they don't directly own, but does own the parent lead.
  if (parsed.data.is_primary === true) {
    const adminSupabase = createAdminClient();
    await adminSupabase
      .from("lead_contacts")
      .update({ is_primary: false })
      .eq("lead_id", ownership.leadId)
      .neq("id", contactId);
  }

  const adminSupabase = createAdminClient();
  const updatePayload = {
    ...fields,
    last_edited_by: user.id,
    last_edited_at: new Date().toISOString(),
  };

  let { data, error } = await adminSupabase
    .from("lead_contacts")
    .update(updatePayload)
    .eq("id", contactId)
    .select()
    .single();

  if (error && (error.message?.includes("is_primary") || error.message?.includes("last_edited_"))) {
    console.warn("[PATCH /api/contacts/[id]] audit columns missing, retrying without them");
    const retry = await adminSupabase
      .from("lead_contacts")
      .update(fields)
      .eq("id", contactId)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: contactId } = await params;

  const ownership = await fetchContactOwnership(contactId);
  if (!ownership) return NextResponse.json({ error: "Kontakt nicht gefunden" }, { status: 404 });
  if (ownership.ownerId !== user.id) {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }

  const adminSupabase = createAdminClient();
  const { error } = await adminSupabase
    .from("lead_contacts")
    .delete()
    .eq("id", contactId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
