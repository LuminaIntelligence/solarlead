"use client";

/**
 * NewLeadButton — opens a modal that lets users manually create a lead
 * with optional images already attached.
 *
 * Flow:
 *   1. User fills form + optionally picks images (Drag&Drop, File-Picker, Camera)
 *   2. Klick "Lead anlegen"
 *   3. Sequential:
 *        a) POST /api/leads (Lead insert + Auto-Geocoding + Async Solar)
 *        b) POST /api/leads/{new_id}/images for each picked image
 *   4. Navigate to lead detail page
 *
 * Design decisions:
 *   - Images buffered client-side (File-Objects) — Upload erst nach erfolgreichem
 *     Lead-Insert, damit wir eine gültige lead_id haben.
 *   - Progress-Feedback: "Lead angelegt · Bild 2/5 wird hochgeladen…"
 *   - Bei Bild-Upload-Fehler: Lead ist trotzdem angelegt, User bekommt Toast
 *     welche Bilder fehlten und kann sie auf der Detail-Seite nachladen.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Image from "next/image";
import {
  Plus,
  Loader2,
  X,
  Building2,
  Check,
  Camera,
  Upload,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { CATEGORY_OPTIONS } from "@/lib/constants/categories";

interface FormState {
  company_name: string;
  category: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  website: string;
  phone: string;
  email: string;
}

/** Bild in der Client-Queue, mit Preview-URL und aktuellem Upload-Status */
interface PendingImage {
  id: string; // Client-side UUID zur Referenz
  file: File;
  preview_url: string; // objectURL für Vorschau
  status: "pending" | "uploading" | "uploaded" | "failed";
  error?: string;
}

const EMPTY: FormState = {
  company_name: "",
  category: CATEGORY_OPTIONS[0]?.value ?? "logistics",
  address: "",
  postal_code: "",
  city: "",
  country: "DE",
  website: "",
  phone: "",
  email: "",
};

const MAX_FILE_MB = 15;
const MAX_IMAGES_ON_CREATE = 10; // Auf Anlage weniger als max 20 auf Detail, damit Modal nicht überfüllt

function makeClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function NewLeadButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    if (saving) return;
    // ObjectURLs freigeben zur Vermeidung von Memory-Leaks
    for (const img of images) {
      try {
        URL.revokeObjectURL(img.preview_url);
      } catch {
        /* ignore */
      }
    }
    setImages([]);
    setForm(EMPTY);
    setOpen(false);
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const roomLeft = MAX_IMAGES_ON_CREATE - images.length;
    if (roomLeft <= 0) {
      toast({
        title: "Bild-Limit erreicht",
        description: `Max ${MAX_IMAGES_ON_CREATE} Bilder bei der Anlage. Weitere gehen später auf der Lead-Detail-Seite.`,
        variant: "destructive",
      });
      return;
    }
    const next: PendingImage[] = [];
    for (const file of arr.slice(0, roomLeft)) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Kein Bild",
          description: `${file.name} übersprungen`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast({
          title: "Datei zu groß",
          description: `${file.name} ist ${Math.round(file.size / 1024 / 1024)} MB, max ${MAX_FILE_MB} MB`,
          variant: "destructive",
        });
        continue;
      }
      next.push({
        id: makeClientId(),
        file,
        preview_url: URL.createObjectURL(file),
        status: "pending",
      });
    }
    if (next.length > 0) {
      setImages((prev) => [...prev, ...next]);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        try {
          URL.revokeObjectURL(target.preview_url);
        } catch {
          /* ignore */
        }
      }
      return prev.filter((i) => i.id !== id);
    });
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function onFilePicker(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  async function handleSave() {
    // Quick validation
    if (!form.company_name.trim()) {
      toast({ title: "Firmenname fehlt", variant: "destructive" });
      return;
    }
    if (!form.address.trim()) {
      toast({ title: "Adresse fehlt", variant: "destructive" });
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Ungültige E-Mail", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // 1) Lead anlegen
      const payload = {
        company_name: form.company_name.trim(),
        category: form.category,
        address: form.address.trim(),
        city: form.city.trim() || "Unbekannt",
        postal_code: form.postal_code.trim() || null,
        country: form.country.trim() || "DE",
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        source: "manual" as const,
      };
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const newId: string | undefined = data?.id ?? data?.lead?.id;
      if (!newId) {
        // Kein ID zurückgekommen — Fallback: Redirect zur Übersicht
        toast({ title: "Lead angelegt", description: form.company_name });
        router.refresh();
        close();
        return;
      }

      // 2) Bilder sequentiell hochladen
      const failed: string[] = [];
      if (images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          setUploadingIdx(i);
          const img = images[i];
          setImages((prev) =>
            prev.map((p) => (p.id === img.id ? { ...p, status: "uploading" } : p))
          );
          try {
            const fd = new FormData();
            fd.append("file", img.file);
            // Dimensionen versuchen zu ermitteln (best-effort)
            try {
              const bmp = await createImageBitmap(img.file);
              fd.append("width", String(bmp.width));
              fd.append("height", String(bmp.height));
              bmp.close();
            } catch {
              /* HEIC etc. — server ignoriert wenn nicht gesetzt */
            }
            const upRes = await fetch(`/api/leads/${newId}/images`, {
              method: "POST",
              body: fd,
            });
            if (!upRes.ok) {
              const upErr = await upRes.json().catch(() => ({}));
              throw new Error(upErr.error ?? `HTTP ${upRes.status}`);
            }
            setImages((prev) =>
              prev.map((p) =>
                p.id === img.id ? { ...p, status: "uploaded" } : p
              )
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Upload-Fehler";
            failed.push(img.file.name);
            setImages((prev) =>
              prev.map((p) =>
                p.id === img.id ? { ...p, status: "failed", error: msg } : p
              )
            );
          }
        }
        setUploadingIdx(null);
      }

      // 3) Toast + Redirect
      const geo = data?.geocoding;
      const partsSummary: string[] = [];
      partsSummary.push(form.company_name);
      if (geo?.ok) partsSummary.push(`Adresse geocoded (${geo.confidence})`);
      if (images.length > 0) {
        const ok = images.length - failed.length;
        partsSummary.push(`${ok}/${images.length} Bilder hochgeladen`);
      }
      toast({
        title: failed.length > 0 ? "Lead angelegt · Bild-Upload teilweise fehlgeschlagen" : "Lead angelegt",
        description: partsSummary.join(" · "),
        variant: failed.length > 0 ? "destructive" : undefined,
      });
      router.push(`/dashboard/leads/${newId}`);
    } catch (e) {
      toast({
        title: "Anlegen fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Neuer Lead
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl mx-4 my-8 bg-white rounded-xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-600" />
            <h2 className="font-semibold text-slate-900">Neuen Lead anlegen</h2>
          </div>
          <button
            onClick={close}
            disabled={saving}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* Firma */}
          <div className="space-y-1.5">
            <Label htmlFor="nl_name">
              Firmenname <span className="text-red-500">*</span>
            </Label>
            <Input
              id="nl_name"
              autoFocus
              value={form.company_name}
              onChange={(e) => update("company_name", e.target.value)}
              placeholder="z.B. Mustermann GmbH"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_category">
              Branche <span className="text-red-500">*</span>
            </Label>
            <select
              id="nl_category"
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              disabled={saving}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_address">
              Adresse <span className="text-red-500">*</span>
            </Label>
            <Input
              id="nl_address"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              placeholder="Musterstraße 1"
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nl_postal">PLZ</Label>
              <Input
                id="nl_postal"
                value={form.postal_code}
                onChange={(e) => update("postal_code", e.target.value)}
                placeholder="12345"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="nl_city">Stadt</Label>
              <Input
                id="nl_city"
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="München"
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_country">Land</Label>
            <Input
              id="nl_country"
              value={form.country}
              onChange={(e) => update("country", e.target.value)}
              placeholder="DE"
              disabled={saving}
              maxLength={3}
              className="max-w-[100px]"
            />
          </div>

          {/* Kontakt (optional) */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-muted-foreground mb-2">
              Kontakt — optional, kann später ergänzt werden
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nl_website">Webseite</Label>
                <Input
                  id="nl_website"
                  type="url"
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                  placeholder="example.com"
                  disabled={saving}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nl_phone">Telefon</Label>
                  <Input
                    id="nl_phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="+49 …"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nl_email">E-Mail</Label>
                  <Input
                    id="nl_email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="info@…"
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bilder (optional) */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Bilder — optional, z.B. Dach, Gebäude, Visitenkarte ({images.length}/{MAX_IMAGES_ON_CREATE})
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={saving || images.length >= MAX_IMAGES_ON_CREATE}
                  className="md:hidden h-7 px-2 text-xs"
                >
                  <Camera className="h-3.5 w-3.5 mr-1" />
                  Kamera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || images.length >= MAX_IMAGES_ON_CREATE}
                  className="h-7 px-2 text-xs"
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Datei
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  onChange={onFilePicker}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onFilePicker}
                  className="hidden"
                />
              </div>
            </div>

            {images.length === 0 ? (
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors text-xs ${
                  dragActive
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <ImageIcon className="h-6 w-6 text-slate-400 mx-auto mb-1" />
                <p className="text-slate-600">
                  Zieh Bilder hier rein oder klick oben auf „Datei" / „Kamera"
                </p>
                <p className="text-slate-400 mt-0.5">
                  Max {MAX_FILE_MB} MB pro Bild
                </p>
              </div>
            ) : (
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                className={`grid grid-cols-3 sm:grid-cols-4 gap-2 ${
                  dragActive ? "ring-2 ring-blue-300 ring-offset-2 rounded-lg" : ""
                }`}
              >
                {images.map((img, i) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-md overflow-hidden bg-slate-100 group"
                  >
                    <Image
                      src={img.preview_url}
                      alt={img.file.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                    {/* Status-Overlay */}
                    {img.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 text-white animate-spin" />
                      </div>
                    )}
                    {img.status === "uploaded" && (
                      <div className="absolute top-1 right-1 bg-green-500 rounded-full p-0.5">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                    {img.status === "failed" && (
                      <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center text-white text-[10px] p-1 text-center">
                        Fehler
                      </div>
                    )}
                    {/* Delete-Button */}
                    {!saving && img.status !== "uploading" && (
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 left-1 bg-slate-900/80 rounded-full p-1 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        title="Entfernen"
                      >
                        <Trash2 className="h-3 w-3 text-white" />
                      </button>
                    )}
                    {/* Fortschritt "Bild x/y" */}
                    {saving && uploadingIdx === i && (
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] text-center py-0.5">
                        {i + 1}/{images.length}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50 sticky bottom-0">
          <Button variant="outline" onClick={close} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.company_name.trim() || !form.address.trim()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {saving
              ? uploadingIdx !== null
                ? `Bild ${uploadingIdx + 1}/${images.length}…`
                : "Lead wird angelegt…"
              : images.length > 0
              ? `Lead anlegen (+ ${images.length} Bild${images.length > 1 ? "er" : ""})`
              : "Lead anlegen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
