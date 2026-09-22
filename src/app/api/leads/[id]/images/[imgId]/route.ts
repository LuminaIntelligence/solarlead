/**
 * Lead-Bild — Einzelaktion.
 *
 * PATCH  /api/leads/[id]/images/[imgId]   → Caption ändern
 * DELETE /api/leads/[id]/images/[imgId]   → Bild löschen (DB-Row + Storage-Datei)
 *
 * Autorisierung: hasLeadAccess + zusätzlich für Delete/Edit:
 *   uploaded_by = self ODER Admin/Team-Lead.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasLeadAccess } from "@/lib/auth/lead-access";

const BUCKET = "lead-images";

const PatchSchema = z.object({
  caption: z.string().nullable().optional(),
});

async function checkImageCanManage(
  imageId: string,
  leadId: string,
  userId: string
): Promise<{ ok: true; storagePath: string } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  if (!(await hasLeadAccess(supabase, leadId, userId))) {
    return { ok: false, status: 404, error: "Lead nicht gefunden" };
  }

  const admin = createAdminClient();
  const { data: img } = await admin
    .from("lead_images")
    .select("id, lead_id, storage_path, uploaded_by")
    .eq("id", imageId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!img) return { ok: false, status: 404, error: "Bild nicht gefunden" };

  // Nur Uploader ODER admin/team_lead darf editieren/löschen
  if (img.uploaded_by !== userId) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    const role = (settings?.role as string | undefined) ?? "user";
    if (!["admin", "team_lead"].includes(role)) {
      return {
        ok: false,
        status: 403,
        error: "Du kannst nur eigene Bilder ändern/löschen",
      };
    }
  }

  return { ok: true, storagePath: img.storage_path as string };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imgId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId, imgId } = await params;
  const check = await checkImageCanManage(imgId, leadId, user.id);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Daten", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_images")
    .update({ caption: parsed.data.caption ?? null })
    .eq("id", imgId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ image: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imgId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId, imgId } = await params;
  const check = await checkImageCanManage(imgId, leadId, user.id);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();

  // Storage-Datei löschen (best-effort)
  const { error: storageErr } = await admin.storage
    .from(BUCKET)
    .remove([check.storagePath]);
  if (storageErr) {
    console.warn(`[DELETE image] Storage-Fehler: ${storageErr.message}`);
  }

  // DB-Row löschen
  const { error: dbErr } = await admin.from("lead_images").delete().eq("id", imgId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
