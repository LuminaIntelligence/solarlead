import { NextResponse } from "next/server";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";

/**
 * GET  /api/admin/outreach/linkedin/templates  — Liste
 * POST /api/admin/outreach/linkedin/templates  — Anlegen
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("linkedin_templates")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const body = await req.json();
  const { name, subject, body: bodyText, is_active, is_default } = body;

  if (!name || !bodyText) {
    return NextResponse.json({ error: "name + body sind Pflicht" }, { status: 400 });
  }
  if (bodyText.length > 2000) {
    return NextResponse.json(
      { error: "Body > 2000 Zeichen (LinkedIn-Limit)" },
      { status: 400 }
    );
  }

  // Wenn als Default markiert: andere Defaults aufheben
  if (is_default) {
    await supabase
      .from("linkedin_templates")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("linkedin_templates")
    .insert({
      name,
      subject: subject ?? null,
      body: bodyText,
      is_active: is_active ?? true,
      is_default: is_default ?? false,
      created_by: user!.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
