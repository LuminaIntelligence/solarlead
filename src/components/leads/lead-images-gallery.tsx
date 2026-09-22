"use client";

/**
 * Lead-Bilder Gallery — Upload + Grid + Lightbox für einen Lead.
 *
 * Verwendung auf /dashboard/leads/[id]/page.tsx:
 *   <LeadImagesGallery leadId={lead.id} />
 *
 * Field-Members können neue Bilder hochladen (Drag&Drop, File-Picker,
 * Kamera direkt vom Handy), bestehende ansehen, Caption editieren und
 * eigene löschen. Admins/Team-Leads können alle Bilder verwalten.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Upload, X, Trash2, Loader2, ImageIcon, PencilLine, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

interface LeadImage {
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
  uploaded_by_email: string | null;
  uploaded_at: string;
  can_manage: boolean;
  signed_url: string | null;
  signed_thumb_url: string | null;
}

interface Props {
  leadId: string;
}

const MAX_FILE_MB = 15;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function LeadImagesGallery({ leadId }: Props) {
  const { toast } = useToast();
  const [images, setImages] = useState<LeadImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lightbox, setLightbox] = useState<LeadImage | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/images`);
      if (res.ok) {
        const data = await res.json();
        setImages(data.images ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadFile(file: File) {
    // Client-side Validation
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast({
        title: "Datei zu groß",
        description: `${file.name} ist ${Math.round(file.size / 1024 / 1024)} MB, max ${MAX_FILE_MB} MB erlaubt.`,
        variant: "destructive",
      });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Kein Bild",
        description: `${file.name} ist kein Bild.`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // Optional: Bild-Dimensionen ermitteln bevor Upload
      let width: number | null = null;
      let height: number | null = null;
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // HEIC oder andere Formate die createImageBitmap nicht kann → egal, wird server-side ignoriert
      }

      const fd = new FormData();
      fd.append("file", file);
      if (width) fd.append("width", String(width));
      if (height) fd.append("height", String(height));

      const res = await fetch(`/api/leads/${leadId}/images`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Upload fehlgeschlagen",
          description: data.error ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      // Neues Bild an den Anfang der Liste
      setImages((prev) => [data.image, ...prev]);
      toast({ title: "Bild hochgeladen", description: file.name });
    } catch (err) {
      toast({
        title: "Upload-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function uploadMultiple(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      await uploadFile(f);
    }
  }

  function onFilePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadMultiple(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) uploadMultiple(e.dataTransfer.files);
  }

  async function saveCaption(img: LeadImage) {
    const res = await fetch(`/api/leads/${leadId}/images/${img.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: captionDraft.trim() || null }),
    });
    if (res.ok) {
      const data = await res.json();
      setImages((prev) =>
        prev.map((i) => (i.id === img.id ? { ...i, caption: data.image.caption } : i))
      );
      setEditingCaption(null);
      toast({ title: "Beschreibung gespeichert" });
    } else {
      const err = await res.json();
      toast({ title: "Fehler", description: err.error, variant: "destructive" });
    }
  }

  async function deleteImage(img: LeadImage) {
    if (!confirm(`Bild "${img.file_name ?? "ohne Namen"}" wirklich löschen? Kann nicht rückgängig gemacht werden.`)) return;
    const res = await fetch(`/api/leads/${leadId}/images/${img.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setImages((prev) => prev.filter((i) => i.id !== img.id));
      if (lightbox?.id === img.id) setLightbox(null);
      toast({ title: "Bild gelöscht" });
    } else {
      const err = await res.json();
      toast({ title: "Fehler", description: err.error, variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-4 w-4 text-blue-600" />
            Bilder {images.length > 0 && <span className="text-sm text-slate-500 font-normal">({images.length})</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              className="md:hidden"
            >
              <Camera className="h-3.5 w-3.5 mr-1.5" />
              Kamera
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Foto hochladen
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              onChange={onFilePickerChange}
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFilePickerChange}
              className="hidden"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : images.length === 0 ? (
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? "border-blue-400 bg-blue-50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <ImageIcon className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              Noch keine Bilder. Zieh eins hier rein oder klick oben auf „Foto hochladen".
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Max {MAX_FILE_MB} MB pro Bild, JPG/PNG/HEIC/WebP.
            </p>
          </div>
        ) : (
          <>
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 ${
                dragActive ? "ring-2 ring-blue-300 ring-offset-2 rounded-lg" : ""
              }`}
            >
              {images.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setLightbox(img)}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-slate-100 hover:ring-2 hover:ring-blue-400 transition-all text-left"
                  title={img.caption ?? img.file_name ?? "Bild"}
                >
                  {img.signed_thumb_url ? (
                    <Image
                      src={img.signed_thumb_url}
                      alt={img.caption ?? img.file_name ?? "Lead-Bild"}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-400">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="text-[10px] text-white truncate">
                      {img.uploaded_by_email ?? "?"}
                    </div>
                    <div className="text-[10px] text-white/70">
                      {formatDate(img.uploaded_at)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {dragActive && (
              <div className="text-center text-xs text-blue-600 mt-2">
                Loslassen zum Hochladen…
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-5xl max-h-[90vh] w-full bg-white rounded-lg overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm">
                <div className="font-medium truncate max-w-[400px]">
                  {lightbox.file_name ?? "Bild"}
                </div>
                <div className="text-xs text-slate-500">
                  Hochgeladen von {lightbox.uploaded_by_email ?? "?"} am{" "}
                  {formatDate(lightbox.uploaded_at)}
                </div>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-900 overflow-auto">
              {lightbox.signed_url && (
                <Image
                  src={lightbox.signed_url}
                  alt={lightbox.caption ?? "Bild"}
                  width={lightbox.width_px ?? 1600}
                  height={lightbox.height_px ?? 1200}
                  unoptimized
                  className="object-contain max-h-[70vh] w-auto h-auto"
                />
              )}
            </div>
            <div className="p-4 border-t bg-slate-50 space-y-2">
              {editingCaption === lightbox.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={captionDraft}
                    onChange={(e) => setCaptionDraft(e.target.value)}
                    placeholder="Beschreibung (z.B. Nord-Dach, aufgenommen am 22.9.)"
                    maxLength={500}
                  />
                  <Button size="sm" onClick={() => saveCaption(lightbox)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingCaption(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-700 flex-1 min-w-0">
                    {lightbox.caption ? (
                      <span>{lightbox.caption}</span>
                    ) : (
                      <span className="text-slate-400 italic">Keine Beschreibung</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {lightbox.can_manage && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCaptionDraft(lightbox.caption ?? "");
                            setEditingCaption(lightbox.id);
                          }}
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteImage(lightbox)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
