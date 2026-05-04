"use client";

/**
 * NewLeadButton — opens a modal that lets users manually create a lead.
 *
 * Use case: a salesperson got a referral, met someone at an event, or a
 * customer walked in. They want a Lead in the system without going through
 * Google Places search or CSV import.
 *
 * After creation, navigates to the new lead's detail page so the user can
 * continue editing/enriching.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Loader2, X, Building2, Check } from "lucide-react";
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

export function NewLeadButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    if (saving) return;
    setOpen(false);
    setForm(EMPTY);
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

      toast({ title: "Lead angelegt", description: form.company_name });
      // Navigate to the new lead so the user can continue editing
      const newId = data?.id ?? data?.lead?.id;
      if (newId) {
        router.push(`/dashboard/leads/${newId}`);
      } else {
        router.refresh();
        close();
      }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl mx-4 my-8 bg-white rounded-xl shadow-2xl border border-slate-200 max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-600" />
            <h2 className="font-semibold text-slate-900">Neuen Lead anlegen</h2>
          </div>
          <button onClick={close} disabled={saving} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="nl_name">Firmenname <span className="text-red-500">*</span></Label>
            <Input id="nl_name" autoFocus value={form.company_name}
              onChange={(e) => update("company_name", e.target.value)}
              placeholder="z.B. Mustermann GmbH" disabled={saving} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_category">Branche <span className="text-red-500">*</span></Label>
            <select
              id="nl_category"
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              disabled={saving}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_address">Adresse <span className="text-red-500">*</span></Label>
            <Input id="nl_address" value={form.address}
              onChange={(e) => update("address", e.target.value)}
              placeholder="Musterstraße 1" disabled={saving} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nl_postal">PLZ</Label>
              <Input id="nl_postal" value={form.postal_code}
                onChange={(e) => update("postal_code", e.target.value)}
                placeholder="12345" disabled={saving} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="nl_city">Stadt</Label>
              <Input id="nl_city" value={form.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="München" disabled={saving} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nl_country">Land</Label>
            <Input id="nl_country" value={form.country}
              onChange={(e) => update("country", e.target.value)}
              placeholder="DE" disabled={saving} maxLength={3} className="max-w-[100px]" />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-muted-foreground mb-2">Optional — kann später ergänzt werden</p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nl_website">Webseite</Label>
                <Input id="nl_website" type="url" value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                  placeholder="example.com" disabled={saving} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nl_phone">Telefon</Label>
                  <Input id="nl_phone" type="tel" value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="+49 …" disabled={saving} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nl_email">E-Mail</Label>
                  <Input id="nl_email" type="email" value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="info@…" disabled={saving} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50">
          <Button variant="outline" onClick={close} disabled={saving}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving || !form.company_name.trim() || !form.address.trim()}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            Lead anlegen
          </Button>
        </div>
      </div>
    </div>
  );
}
