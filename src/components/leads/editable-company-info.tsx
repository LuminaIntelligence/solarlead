"use client";

/**
 * EditableCompanyInfo — Client-Component for inline-editing the core
 * lead "Stammdaten" fields. Replaces the previous read-only InfoRow grid.
 *
 * Each field uses the generic <EditableField>. Save handlers do an optimistic
 * local update + PATCH to /api/leads/[id]. Failures revert via toast.
 *
 * The "Quelle" badge stays read-only — that's metadata, not user-editable.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, MapPin, Globe, Phone, Mail, Tag, FileText, Hash, Clock, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { EditableField } from "@/components/ui/editable-field";
import { CATEGORY_OPTIONS } from "@/lib/constants/categories";

interface LeadCore {
  id: string;
  company_name: string;
  category: string;
  address: string;
  city: string;
  postal_code: string | null;
  country: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  place_id: string | null;
  source: string;
  last_edited_at?: string | null;
  last_edited_by_email?: string | null;
}

interface Props {
  lead: LeadCore;
  /** When false the user cannot edit (read-only view, e.g. for archived leads). */
  canEdit?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  google_places: "Google Places",
  csv_import: "CSV-Import",
  manual: "Manuell",
};

function formatCategory(value: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function EditableCompanyInfo({ lead, canEdit = true }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  // Local state for optimistic updates — revert on failure.
  const [data, setData] = useState<LeadCore>(lead);
  const [editingCategory, setEditingCategory] = useState(false);

  /** Save a single field via PATCH. Returns rejection on failure. */
  async function saveField<K extends keyof LeadCore>(field: K, value: LeadCore[K]) {
    const original = data[field];
    setData((d) => ({ ...d, [field]: value })); // optimistic
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const updated = await res.json();
      // Sync any server-side changes (last_edited_at)
      setData((d) => ({
        ...d,
        [field]: value,
        last_edited_at: updated.last_edited_at ?? new Date().toISOString(),
      }));
      // Revalidate server data so other tabs/sections see the change on reload
      router.refresh();
    } catch (e) {
      setData((d) => ({ ...d, [field]: original })); // revert
      const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
      toast({ title: "Fehler beim Speichern", description: msg, variant: "destructive" });
      throw e; // let EditableField show the inline error too
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5" />
          Unternehmensinformationen
          {canEdit && (
            <span className="text-xs font-normal text-slate-400 ml-1">
              · Felder klicken zum Bearbeiten
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <EditableField
          label="Name"
          icon={<Building2 className="h-3.5 w-3.5" />}
          value={data.company_name}
          onSave={(v) => saveField("company_name", v ?? "")}
          readOnly={!canEdit}
          validate={(v) => (v.trim().length === 0 ? "Name darf nicht leer sein" : null)}
        />

        {/* Category — needs a select, not a free-text input */}
        <div className="group flex items-start gap-2">
          <span className="text-xs text-slate-500 shrink-0 w-28 pt-0.5">Kategorie</span>
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            {!editingCategory ? (
              <>
                <span className="text-slate-900 truncate">{formatCategory(data.category)}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditingCategory(true)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700"
                    title="Bearbeiten"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                )}
              </>
            ) : (
              <select
                autoFocus
                defaultValue={data.category}
                onChange={async (e) => {
                  setEditingCategory(false);
                  if (e.target.value !== data.category) {
                    try { await saveField("category", e.target.value); } catch { /* toast handled */ }
                  }
                }}
                onBlur={() => setEditingCategory(false)}
                className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <EditableField
          label="Adresse"
          icon={<MapPin className="h-3.5 w-3.5" />}
          value={data.address}
          onSave={(v) => saveField("address", v ?? "")}
          readOnly={!canEdit}
          placeholder="Straße + Nr."
        />
        <EditableField
          label="PLZ"
          value={data.postal_code}
          onSave={(v) => saveField("postal_code", v)}
          readOnly={!canEdit}
          placeholder="PLZ"
        />
        <EditableField
          label="Stadt"
          icon={<MapPin className="h-3.5 w-3.5" />}
          value={data.city}
          onSave={(v) => saveField("city", v ?? "")}
          readOnly={!canEdit}
        />
        <EditableField
          label="Webseite"
          icon={<Globe className="h-3.5 w-3.5" />}
          value={data.website}
          onSave={(v) => saveField("website", v)}
          readOnly={!canEdit}
          type="url"
          linkPrefix="url"
          placeholder="example.com"
        />
        <EditableField
          label="Telefon"
          icon={<Phone className="h-3.5 w-3.5" />}
          value={data.phone}
          onSave={(v) => saveField("phone", v)}
          readOnly={!canEdit}
          type="tel"
          linkPrefix="tel:"
          placeholder="+49 …"
        />
        <EditableField
          label="E-Mail"
          icon={<Mail className="h-3.5 w-3.5" />}
          value={data.email}
          onSave={(v) => saveField("email", v)}
          readOnly={!canEdit}
          type="email"
          linkPrefix="mailto:"
          placeholder="info@…"
          validate={(v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "Ungültige E-Mail" : null)}
        />

        {/* Read-only metadata */}
        {data.place_id && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 shrink-0 w-28 pt-0.5">Place ID</span>
            <div className="flex-1 flex items-center gap-1.5 min-w-0">
              <Hash className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate">{data.place_id}</span>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="text-xs text-slate-500 shrink-0 w-28 pt-0.5">Quelle</span>
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Badge variant="outline">{SOURCE_LABELS[data.source] ?? data.source}</Badge>
          </div>
        </div>

        {/* Audit footer */}
        {data.last_edited_at && (
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-slate-100 text-xs text-slate-400">
            <Clock className="h-3 w-3" />
            <span>
              Zuletzt bearbeitet:{" "}
              {new Date(data.last_edited_at).toLocaleString("de-DE", {
                day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
            {data.last_edited_by_email && (
              <>
                <User className="h-3 w-3 ml-1" />
                <span>{data.last_edited_by_email}</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
