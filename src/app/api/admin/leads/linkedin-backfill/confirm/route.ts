/**
 * POST /api/admin/leads/linkedin-backfill/confirm
 * Bestätigt oder verwirft einen Review-Vorschlag aus dem Backfill.
 *
 * Body:
 *   { contact_id: string, linkedin_url: string | null, accept: true }  → übernehmen
 *   { contact_id: string, accept: false, delete_contact?: boolean }    → verwerfen
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPersonalLinkedInUrl } from "@/lib/linkedin/finder";

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const body = await req.json();
  const contactId = body.contact_id as string;
  const accept = !!body.accept;

  if (!contactId) {
    return NextResponse.json({ error: "contact_id fehlt" }, { status: 400 });
  }

  const sb = createAdminClient();

  if (accept) {
    const linkedinUrl = (body.linkedin_url as string | null) ?? null;
    if (linkedinUrl && !isPersonalLinkedInUrl(linkedinUrl)) {
      return NextResponse.json(
        { error: "URL ist kein persönliches LinkedIn-Profil (/in/...)" },
        { status: 400 }
      );
    }
    const { error } = await sb
      .from("lead_contacts")
      .update({
        linkedin_url: linkedinUrl,
        is_primary: true,
        source: "google_cse",
      })
      .eq("id", contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, applied: true });
  }

  // Reject
  if (body.delete_contact) {
    const { error } = await sb.from("lead_contacts").delete().eq("id", contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: true });
  } else {
    // Soft-reject: linkedin_url leer lassen, source ändern, is_primary off
    const { error } = await sb
      .from("lead_contacts")
      .update({
        is_primary: false,
        source: "google_cse_rejected",
      })
      .eq("id", contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, rejected: true });
  }
}
