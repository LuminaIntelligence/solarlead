"use client";

/**
 * LeadContacts — manages the contacts list for a single lead.
 *
 * Three sources of contacts:
 *   1. Apollo.io / Hunter.io / Impressum / Firecrawl (auto-search via "Kontakte suchen")
 *   2. Manual entry (the new "+ Kontakt hinzufügen" button)
 *   3. Inline-editing of any existing contact (auto-discovered or manual)
 *
 * Per-contact actions: edit, delete, mark as primary (star).
 * Manual contacts are tagged with source='manual' and visually distinguishable.
 */
import { useState } from "react";
import {
  Users, Loader2, Mail, Phone, Linkedin, RefreshCw, Building2, UserCheck,
  TrendingUp, Briefcase, ExternalLink, Plus, Pencil, Trash2, Star, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { LeadContact } from "@/types/database";

interface CompanyEnrichment {
  estimated_num_employees: number | null;
  annual_revenue: number | null;
  industry: string | null;
  description: string | null;
  linkedin_url: string | null;
}

interface LeadContactsProps {
  leadId: string;
  website: string | null;
  companyName: string;
  city: string;
  initialContacts: LeadContact[];
}

const SENIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "c_suite", label: "C-Suite" },
  { value: "vp", label: "VP" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "individual_contributor", label: "Mitarbeiter" },
];

function seniorityLabel(s: string | null): string {
  return SENIORITY_OPTIONS.find((o) => o.value === s)?.label ?? s ?? "";
}

function seniorityColor(s: string | null): string {
  switch (s) {
    case "c_suite": return "bg-purple-100 text-purple-800";
    case "vp": return "bg-blue-100 text-blue-800";
    case "director": return "bg-indigo-100 text-indigo-800";
    case "manager": return "bg-green-100 text-green-800";
    default: return "bg-slate-100 text-slate-600";
  }
}

function formatRevenue(rev: number | null): string {
  if (!rev) return "–";
  if (rev >= 1_000_000_000) return `${(rev / 1_000_000_000).toFixed(1)} Mrd. €`;
  if (rev >= 1_000_000) return `${(rev / 1_000_000).toFixed(1)} Mio. €`;
  return `${rev.toLocaleString("de-DE")} €`;
}

const SOURCE_LABEL: Record<string, string> = {
  apollo: "Apollo",
  hunter: "Hunter",
  impressum: "Impressum",
  firecrawl: "Firecrawl",
  mock: "Mock",
  manual: "Manuell",
};

interface ContactFormData {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  seniority: string;
  department: string;
}

const EMPTY_FORM: ContactFormData = {
  name: "", title: "", email: "", phone: "", linkedin_url: "", seniority: "", department: "",
};

function contactToForm(c: LeadContact): ContactFormData {
  return {
    name: c.name ?? "",
    title: c.title ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    linkedin_url: c.linkedin_url ?? "",
    seniority: c.seniority ?? "",
    department: c.department ?? "",
  };
}

export function LeadContacts({
  leadId, website, companyName, city, initialContacts,
}: LeadContactsProps) {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<LeadContact[]>(initialContacts);
  const [company, setCompany] = useState<CompanyEnrichment | null>(null);
  const [loading, setLoading] = useState(false);

  // Add-form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ContactFormData>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  // Per-card edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContactFormData>(EMPTY_FORM);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Domain aus Website extrahieren (Client-Seite)
  const domain = website
    ? (() => {
        try {
          const url = website.includes("://") ? website : `https://${website}`;
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return website.replace(/^www\./, "").split("/")[0];
        }
      })()
    : null;

  /** Trigger the auto-search pipeline (Apollo → Impressum → Hunter → Firecrawl). */
  async function handleAutoSearch() {
    if (!domain && !companyName) {
      toast({
        title: "Keine Domain verfügbar",
        description: "Fügen Sie dem Lead eine Website hinzu, um Kontakte zu suchen.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          domain: domain ?? companyName,
          company_name: companyName,
          city,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Fehler" }));
        throw new Error(err.error);
      }
      const data = await res.json();
      // Merge with existing manual contacts (auto-search returns full set incl. existing)
      setContacts(data.contacts ?? []);
      setCompany(data.company ?? null);

      if ((data.contacts ?? []).length === 0) {
        toast({ title: "Keine Kontakte gefunden", description: `Für ${domain ?? companyName} wurden keine Ansprechpartner gefunden.` });
      } else {
        toast({
          title: `${data.contacts.length} Kontakt${data.contacts.length !== 1 ? "e" : ""} gefunden`,
          description: `Quelle: ${SOURCE_LABEL[data.provider] ?? data.provider}`,
        });
      }
    } catch (error) {
      toast({
        title: "Suche fehlgeschlagen",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  /** Insert a manual contact via POST /api/leads/[id]/contacts. */
  async function handleAdd() {
    if (!addForm.name.trim()) {
      toast({ title: "Name fehlt", description: "Der Name ist erforderlich.", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(addForm).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()])
      );
      const res = await fetch(`/api/leads/${leadId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Hinzufügen fehlgeschlagen");
      setContacts((cs) => [data.contact, ...cs]);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      toast({ title: "Kontakt hinzugefügt" });
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  }

  function startEdit(contact: LeadContact) {
    setEditingId(contact.id);
    setEditForm(contactToForm(contact));
  }

  async function handleEditSave() {
    if (!editingId) return;
    if (!editForm.name.trim()) {
      toast({ title: "Name fehlt", variant: "destructive" });
      return;
    }
    setSavingId(editingId);
    try {
      const payload = Object.fromEntries(
        Object.entries(editForm).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()])
      );
      const res = await fetch(`/api/contacts/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setContacts((cs) => cs.map((c) => (c.id === editingId ? data.contact : c)));
      setEditingId(null);
      toast({ title: "Kontakt aktualisiert" });
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(contactId: string, contactName: string) {
    if (!confirm(`Kontakt "${contactName}" wirklich löschen?`)) return;
    setSavingId(contactId);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Löschen fehlgeschlagen");
      }
      setContacts((cs) => cs.filter((c) => c.id !== contactId));
      toast({ title: "Kontakt gelöscht" });
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleTogglePrimary(contact: LeadContact) {
    const wasPrimary = !!contact.is_primary;
    // Optimistic
    setContacts((cs) =>
      cs.map((c) => ({
        ...c,
        is_primary: c.id === contact.id ? !wasPrimary : (wasPrimary ? c.is_primary : false),
      }))
    );
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_primary: !wasPrimary }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Markierung fehlgeschlagen");
      }
    } catch (e) {
      // Revert
      setContacts((cs) =>
        cs.map((c) => ({ ...c, is_primary: c.id === contact.id ? wasPrimary : c.is_primary }))
      );
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  }

  // Sort: primary first, then by source (manual first), then by created_at
  const sortedContacts = [...contacts].sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1;
    if ((a.source === "manual") !== (b.source === "manual")) return a.source === "manual" ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-4">
      {/* Aktionsleiste */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          {domain ? (
            <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">{domain}</span>
          ) : (
            <span className="text-amber-600 text-xs">Keine Website hinterlegt</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowAddForm((v) => !v); setAddForm(EMPTY_FORM); }}
            disabled={adding}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {showAddForm ? "Abbrechen" : "Kontakt hinzufügen"}
          </Button>
          <Button
            size="sm"
            onClick={handleAutoSearch}
            disabled={loading}
            variant={contacts.length > 0 ? "outline" : "default"}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {loading ? "Suche läuft…" : contacts.length > 0 ? "Auto-Suche neu" : "Kontakte automatisch suchen"}
          </Button>
        </div>
      </div>

      {/* Add-Form */}
      {showAddForm && (
        <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-600" />
            Neuer Kontakt
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Name *" value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            <Input placeholder="Titel (z.B. Geschäftsführer)" value={addForm.title}
              onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} />
            <Input type="email" placeholder="E-Mail" value={addForm.email}
              onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            <Input type="tel" placeholder="Telefon" value={addForm.phone}
              onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
            <Input type="url" placeholder="LinkedIn-URL" value={addForm.linkedin_url}
              onChange={(e) => setAddForm({ ...addForm, linkedin_url: e.target.value })} />
            <select
              value={addForm.seniority}
              onChange={(e) => setAddForm({ ...addForm, seniority: e.target.value })}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label || "Seniority wählen"}</option>
              ))}
            </select>
            <Input placeholder="Abteilung" value={addForm.department}
              onChange={(e) => setAddForm({ ...addForm, department: e.target.value })}
              className="sm:col-span-2" />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} disabled={adding}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={adding || !addForm.name.trim()}>
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Speichern
            </Button>
          </div>
        </div>
      )}

      {/* Firmographics */}
      {company && (
        <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <Building2 className="h-4 w-4" /> Unternehmens-Daten
          </h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {company.estimated_num_employees && (
              <div className="flex items-center gap-2">
                <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Mitarbeiter:</span>
                <span className="font-medium">{company.estimated_num_employees.toLocaleString("de-DE")}</span>
              </div>
            )}
            {company.annual_revenue && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Umsatz:</span>
                <span className="font-medium">{formatRevenue(company.annual_revenue)}</span>
              </div>
            )}
            {company.industry && (
              <div className="flex items-center gap-2 col-span-2">
                <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Branche:</span>
                <span className="font-medium">{company.industry}</span>
              </div>
            )}
            {company.linkedin_url && (
              <div className="flex items-center gap-2 col-span-2">
                <Linkedin className="h-3.5 w-3.5 text-[#0a66c2]" />
                <span className="text-muted-foreground">LinkedIn:</span>
                <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1 text-[#0a66c2] hover:underline font-medium text-xs">
                  Firmenprofil öffnen <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Kontaktliste */}
      {sortedContacts.length > 0 ? (
        <div className="space-y-3">
          {sortedContacts.map((contact) => {
            const isEditing = editingId === contact.id;
            const isBusy = savingId === contact.id;
            return (
              <div
                key={contact.id}
                className={`group rounded-lg border bg-white p-4 transition-shadow ${
                  contact.is_primary ? "ring-2 ring-yellow-300 border-yellow-200" : "hover:shadow-sm"
                }`}
              >
                {!isEditing ? (
                  <>
                    {/* View mode */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">{contact.name}</p>
                          {contact.is_primary && (
                            <Badge className="bg-yellow-400 text-yellow-900 text-[10px] border-0">
                              ⭐ Hauptkontakt
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
                            {SOURCE_LABEL[contact.source] ?? contact.source}
                          </Badge>
                        </div>
                        {contact.title && (
                          <p className="text-sm text-muted-foreground">{contact.title}</p>
                        )}
                        {contact.department && (
                          <p className="text-xs text-slate-400">{contact.department}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {contact.seniority && (
                          <Badge variant="secondary" className={`text-xs shrink-0 ${seniorityColor(contact.seniority)}`}>
                            {seniorityLabel(contact.seniority)}
                          </Badge>
                        )}
                        {/* Action buttons — appear on hover */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleTogglePrimary(contact)}
                            disabled={isBusy}
                            title={contact.is_primary ? "Nicht mehr Hauptkontakt" : "Als Hauptkontakt markieren"}
                            className={`p-1.5 rounded hover:bg-yellow-50 ${contact.is_primary ? "text-yellow-500" : "text-slate-400 hover:text-yellow-500"}`}
                          >
                            <Star className={`h-3.5 w-3.5 ${contact.is_primary ? "fill-current" : ""}`} />
                          </button>
                          <button
                            onClick={() => startEdit(contact)}
                            disabled={isBusy}
                            title="Bearbeiten"
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(contact.id, contact.name)}
                            disabled={isBusy}
                            title="Löschen"
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Kontaktdaten */}
                    <div className="flex flex-wrap gap-3 text-sm mt-2">
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-blue-600 hover:underline">
                          <Mail className="h-3.5 w-3.5" />{contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900">
                          <Phone className="h-3.5 w-3.5" />{contact.phone}
                        </a>
                      )}
                      {contact.linkedin_url && (
                        <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-1.5 text-[#0a66c2] hover:underline">
                          <Linkedin className="h-3.5 w-3.5" />LinkedIn
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Edit mode */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-900">Kontakt bearbeiten</h4>
                        <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-700" title="Abbrechen">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input placeholder="Name *" value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        <Input placeholder="Titel" value={editForm.title}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                        <Input type="email" placeholder="E-Mail" value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                        <Input type="tel" placeholder="Telefon" value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                        <Input type="url" placeholder="LinkedIn-URL" value={editForm.linkedin_url}
                          onChange={(e) => setEditForm({ ...editForm, linkedin_url: e.target.value })} />
                        <select
                          value={editForm.seniority}
                          onChange={(e) => setEditForm({ ...editForm, seniority: e.target.value })}
                          className="px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          {SENIORITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label || "Seniority wählen"}</option>
                          ))}
                        </select>
                        <Input placeholder="Abteilung" value={editForm.department}
                          onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                          className="sm:col-span-2" />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={isBusy}>
                          Abbrechen
                        </Button>
                        <Button size="sm" onClick={handleEditSave} disabled={isBusy || !editForm.name.trim()}>
                          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                          Speichern
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : !loading && !showAddForm ? (
        <div className="flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-slate-200">
          <div className="text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-muted-foreground">Noch keine Kontakte.</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              „Kontakt hinzufügen" für manuelle Eingabe oder „Kontakte automatisch suchen" für Apollo/Hunter/Impressum.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
