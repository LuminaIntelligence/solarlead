/**
 * Lead-Bilder — Upload + List.
 *
 * GET  /api/leads/[id]/images   → Liste aller Bilder eines Leads, mit
 *                                  signierten URLs (1h Ablauf).
 * POST /api/leads/[id]/images   → Ein Bild hochladen (multipart/form-data).
 *
 * Zugriff via hasLeadAccess() — Field-Members können nur Bilder von
 * ihren eigenen/zugewiesenen Leads sehen und hochladen.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasLeadAccess } from "@/lib/auth/lead-access";
import { randomUUID } from "crypto";

export const maxDuration = 60;

const BUCKET = "lead-images";
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_IMAGES_PER_LEAD = 20;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 Stunde

interface ImageMeta {
  id: string;
  lead_id: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  width_px: number | null;
  height_px: number | null;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  if (!(await hasLeadAccess(supabase, leadId, user.id))) {
    return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  }

  const { data: images, error } = await supabase
    .from("lead_images")
    .select("*")
    .eq("lead_id", leadId)
    .order("uploaded_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Uploader-Email dazu joinen (aus auth.users via admin client)
  const admin = createAdminClient();
  const uploaderIds = Array.from(
    new Set((images ?? []).map((i) => i.uploaded_by).filter((v): v is string => !!v))
  );
  const emails: Record<string, string> = {};
  if (uploaderIds.length > 0) {
    const { data: users } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of users?.users ?? []) {
      if (uploaderIds.includes(u.id)) emails[u.id] = u.email ?? "";
    }
  }

  // Signierte URLs für jedes Bild erzeugen (Admin-Client umgeht bucket-policies)
  const enriched = await Promise.all(
    (images ?? []).map(async (img: ImageMeta) => {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(img.storage_path, SIGNED_URL_EXPIRY_SECONDS);
      const { data: signedThumb } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(img.storage_path, SIGNED_URL_EXPIRY_SECONDS, {
          transform: { width: 300, height: 300, resize: "cover" },
        });
      return {
        ...img,
        uploaded_by_email: img.uploaded_by ? emails[img.uploaded_by] ?? null : null,
        can_manage:
          img.uploaded_by === user.id, // Delete/Edit nur eigenes
        signed_url: signed?.signedUrl ?? null,
        signed_thumb_url: signedThumb?.signedUrl ?? signed?.signedUrl ?? null,
      };
    })
  );

  return NextResponse.json({ images: enriched });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leadId } = await params;
  if (!(await hasLeadAccess(supabase, leadId, user.id))) {
    return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  }

  // Limit-Check: max 20 Bilder pro Lead — nebenbei prüfen wir dass die
  // Tabelle überhaupt existiert (Migration 20260922_lead_images muss
  // vorher im Supabase-Dashboard SQL-Editor gelaufen sein).
  const { count, error: countErr } = await supabase
    .from("lead_images")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);
  if (countErr) {
    const msg = countErr.message ?? "";
    if (msg.includes("does not exist") || msg.includes("schema cache") || countErr.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Die Bild-Tabelle ist noch nicht angelegt. Admin muss die Migration 20260922_lead_images.sql einmalig im Supabase-Dashboard ausführen.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (count !== null && count >= MAX_IMAGES_PER_LEAD) {
    return NextResponse.json(
      {
        error: `Max. ${MAX_IMAGES_PER_LEAD} Bilder pro Lead erreicht. Bitte alte Bilder löschen bevor du neue hinzufügst.`,
      },
      { status: 400 }
    );
  }

  // multipart-Form-Data parsen (Native Next.js/Web-APIs)
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Ungültiges Multipart-Payload" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const caption = (formData.get("caption") as string | null) ?? null;
  const widthStr = formData.get("width") as string | null;
  const heightStr = formData.get("height") as string | null;

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Kein File in FormData" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `Datei zu groß (${Math.round(file.size / 1024 / 1024)} MB), max 15 MB` },
      { status: 400 }
    );
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `MIME-Typ nicht erlaubt: ${mime}` },
      { status: 400 }
    );
  }

  // Storage-Pfad + Upload via Admin-Client
  const imageId = randomUUID();
  const ext =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/png"
      ? "png"
      : mime === "image/webp"
      ? "webp"
      : "heic";
  const storagePath = `${leadId}/${imageId}.${ext}`;

  const admin = createAdminClient();
  const uploadBuf = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, uploadBuf, {
      contentType: mime,
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload fehlgeschlagen: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  // Metadaten in DB
  const original =
    typeof (file as unknown as { name?: unknown }).name === "string"
      ? ((file as unknown as { name: string }).name as string)
      : null;
  const { data: imgRow, error: dbErr } = await admin
    .from("lead_images")
    .insert({
      id: imageId,
      lead_id: leadId,
      storage_path: storagePath,
      file_name: original,
      file_size_bytes: file.size,
      mime_type: mime,
      width_px: widthStr ? Number(widthStr) || null : null,
      height_px: heightStr ? Number(heightStr) || null : null,
      caption,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (dbErr) {
    // Best-effort: hochgeladenes File wieder wegräumen wenn DB-Insert scheitert
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  // Signierte URL für sofortige Anzeige mitliefern
  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  const { data: signedThumb } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS, {
      transform: { width: 300, height: 300, resize: "cover" },
    });

  return NextResponse.json(
    {
      image: {
        ...imgRow,
        uploaded_by_email: user.email ?? null,
        can_manage: true,
        signed_url: signed?.signedUrl ?? null,
        signed_thumb_url: signedThumb?.signedUrl ?? signed?.signedUrl ?? null,
      },
    },
    { status: 201 }
  );
}
