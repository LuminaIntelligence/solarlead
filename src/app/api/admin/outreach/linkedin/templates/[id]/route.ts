import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const { id } = await params;
  const body = await req.json();
  const allowed = ["name", "subject", "body", "is_active", "is_default"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) updates[k] = body[k];

  if (updates.is_default === true) {
    await supabase
      .from("linkedin_templates")
      .update({ is_default: false })
      .neq("id", id);
  }

  const { data, error } = await supabase
    .from("linkedin_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const { id } = await params;
  const { error } = await supabase.from("linkedin_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
