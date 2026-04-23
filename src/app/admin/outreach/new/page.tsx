"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BestContact {
  id: string;
  name: string;
  email: string;
  title: string | null;
  seniority: string | null;
}

interface OutreachLead {
  id: string;
  company_name: string;
  city: string;
  category: string;
  total_score: number;
  status: string;
  best_contact: BestContact;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const categoryOptions = [
  { value: "logistics", label: "Logistik" },
  { value: "warehouse", label: "Lager" },
  { value: "cold_storage", label: "Kühlhaus" },
  { value: "supermarket", label: "Supermarkt" },
  { value: "food_production", label: "Lebensmittelproduktion" },
  { value: "manufacturing", label: "Fertigung" },
  { value: "metalworking", label: "Metallverarbeitung" },
  { value: "car_dealership", label: "Autohaus" },
  { value: "hotel", label: "Hotel" },
  { value: "furniture_store", label: "Möbelhaus" },
  { value: "hardware_store", label: "Baumarkt" },
  { value: "shopping_center", label: "Einkaufszentrum" },
];

const categoryLabels: Record<string, string> = Object.fromEntries(
  categoryOptions.map(({ value, label }) => [value, label])
);

const statusLabels: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { n: 1, label: "Leads filtern" },
    { n: 2, label: "Batch konfigurieren" },
    { n: 3, label: "Bestätigen" },
  ];

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((step, i) => (
        <div key={step.n} className="flex items-center">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
              current === step.n
                ? "bg-red-600 text-white"
                : current > step.n
                ? "bg-green-600/30 text-green-400"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {current > step.n ? <CheckCircle2 className="h-4 w-4" /> : step.n}
          </div>
          <span
            className={`ml-2 text-sm font-medium ${
              current === step.n ? "text-slate-900" : "text-slate-500"
            }`}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div
              className={`mx-4 h-px w-12 ${
                current > step.n + 0 ? "bg-green-600/40" : "bg-slate-200"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ScoreColor({ score }: { score: number }) {
  const cls =
    score >= 70
      ? "bg-green-700/30 text-green-300"
      : score >= 50
      ? "bg-yellow-700/30 text-yellow-300"
      : "bg-red-700/30 text-red-300";
  return (
    <Badge variant="secondary" className={cls}>
      {score}
    </Badge>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewOutreachPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState(1);

  // Step 1: filter params
  const [minScore, setMinScore] = useState(60);
  const [statusNew, setStatusNew] = useState(true);
  const [statusReviewed, setStatusReviewed] = useState(true);
  const [category, setCategory] = useState("");

  // Step 1: search results
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [searched, setSearched] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Step 2: batch config
  const [batchName, setBatchName] = useState("");
  const [description, setDescription] = useState("");
  const [dailyLimit, setDailyLimit] = useState(100);
  const [templateType, setTemplateType] = useState<"erstkontakt" | "followup" | "finale">("erstkontakt");

  // Step 3: submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearchError(null);
    setSearched(true);

    const statuses: string[] = [];
    if (statusNew) statuses.push("new");
    if (statusReviewed) statuses.push("reviewed");

    const params = new URLSearchParams();
    params.set("minScore", String(minScore));
    if (statuses.length > 0) params.set("status", statuses.join(","));
    if (category) params.set("category", category);

    try {
      const res = await fetch(`/api/admin/outreach/leads?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? "Unbekannter Fehler");
        setLeads([]);
        return;
      }
      if (data.warning) {
        setSearchError(data.warning);
      }
      setLeads(data.leads ?? []);
      // Pre-select all found leads
      setSelectedIds(new Set((data.leads ?? []).map((l: OutreachLead) => l.id)));
    } catch {
      setSearchError("Netzwerkfehler beim Suchen der Leads.");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [minScore, statusNew, statusReviewed, category]);

  function toggleSelectAll() {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const selectedLeads = leads.filter((l) => selectedIds.has(l.id));
  const daysNeeded = Math.ceil(selectedLeads.length / dailyLimit);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);

    const contactMap: Record<string, { name: string; email: string; title: string }> = {};
    for (const lead of selectedLeads) {
      contactMap[lead.id] = {
        name: lead.best_contact.name,
        email: lead.best_contact.email,
        title: lead.best_contact.title ?? "",
      };
    }

    try {
      const res = await fetch("/api/admin/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: batchName,
          description: description || undefined,
          daily_limit: dailyLimit,
          lead_ids: selectedLeads.map((l) => l.id),
          contact_map: contactMap,
          template_type: templateType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Unbekannter Fehler beim Erstellen.");
        return;
      }

      router.push("/admin/outreach");
    } catch {
      setSubmitError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Neuen Batch erstellen
        </h1>
        <p className="text-slate-600">
          Leads filtern, Batch konfigurieren und Massenversand starten
        </p>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Leads filtern ── */}
      {step === 1 && (
        <div className="space-y-5">
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-slate-900">Leads filtern</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Min Score */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Mindest-Score:{" "}
                  <span className="text-red-500 font-bold">{minScore}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full accent-red-500"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>

              {/* Status checkboxes */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Status
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statusNew}
                      onChange={(e) => setStatusNew(e.target.checked)}
                      className="accent-red-500"
                    />
                    Neu
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statusReviewed}
                      onChange={(e) => setStatusReviewed(e.target.checked)}
                      className="accent-red-500"
                    />
                    Geprüft
                  </label>
                </div>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Kategorie (optional)
                </label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v === "all" ? "" : v)}
                >
                  <SelectTrigger className="w-[260px] bg-white border-slate-300 text-slate-900">
                    <SelectValue placeholder="Alle Kategorien" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-slate-300 text-slate-900">
                    <SelectItem value="all">Alle Kategorien</SelectItem>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleSearch}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Leads suchen
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          {(searched || leads.length > 0) && (
            <Card className="bg-white border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-slate-900">
                  {leads.length > 0
                    ? `${leads.length} Lead${leads.length !== 1 ? "s" : ""} mit E-Mail-Kontakt gefunden`
                    : "Keine Leads gefunden"}
                </CardTitle>
                {leads.length > 0 && (
                  <span className="text-sm text-slate-500">
                    {selectedIds.size} ausgewählt
                  </span>
                )}
              </CardHeader>

              {searchError && (
                <div className="mx-4 mb-4 flex items-start gap-2 rounded-md bg-yellow-900/20 border border-yellow-600/30 p-3">
                  <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-yellow-300">{searchError}</p>
                </div>
              )}

              {leads.length > 0 && (
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                          <th className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={
                                selectedIds.size === leads.length &&
                                leads.length > 0
                              }
                              onChange={toggleSelectAll}
                              className="accent-red-500"
                            />
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Unternehmen
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Stadt
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Kategorie
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Score
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Kontakt
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            E-Mail
                          </th>
                          <th className="px-4 py-3 font-medium text-slate-500">
                            Position
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((lead) => (
                          <tr
                            key={lead.id}
                            className={`border-b border-slate-200 last:border-0 cursor-pointer transition-colors ${
                              selectedIds.has(lead.id)
                                ? "bg-red-50"
                                : "hover:bg-slate-50"
                            }`}
                            onClick={() => toggleSelect(lead.id)}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(lead.id)}
                                onChange={() => toggleSelect(lead.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="accent-red-500"
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {lead.company_name}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {lead.city}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {categoryLabels[lead.category] ?? lead.category}
                            </td>
                            <td className="px-4 py-3">
                              <ScoreColor score={lead.total_score} />
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {lead.best_contact.name}
                            </td>
                            <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                              {lead.best_contact.email}
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs">
                              {lead.best_contact.title ?? "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              disabled={selectedIds.size === 0}
              onClick={() => setStep(2)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Weiter
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Batch konfigurieren ── */}
      {step === 2 && (
        <div className="space-y-5">
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-slate-900">Batch konfigurieren</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Batch name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Batch-Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="z.B. Logistik Bayern April 2026"
                  className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                />
              </div>

              {/* Template type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  E-Mail-Vorlage <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: "erstkontakt", label: "1. Erstkontakt", desc: "Dachfläche pachten – keine Werbung!", color: "border-blue-500 bg-blue-50 text-blue-700" },
                    { value: "followup", label: "2. Follow-up", desc: "Kurze Nachfrage zu Ihrer Dachfläche", color: "border-yellow-500 bg-yellow-50 text-yellow-700" },
                    { value: "finale", label: "3. Finale", desc: "Wir haben uns bisher verpasst", color: "border-orange-500 bg-orange-50 text-orange-700" },
                  ].map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTemplateType(t.value as typeof templateType)}
                      className={`rounded-lg border-2 p-3 text-left transition-colors ${
                        templateType === t.value
                          ? t.color
                          : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      <p className="text-sm font-semibold">{t.label}</p>
                      <p className="text-xs mt-0.5 opacity-80">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Beschreibung (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Interne Notiz zu diesem Batch..."
                  rows={3}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>

              {/* Daily limit */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Tageslimit:{" "}
                  <span className="text-red-500 font-bold">{dailyLimit}</span>{" "}
                  E-Mails/Tag
                </label>
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={10}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="w-full accent-red-500"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>10</span>
                  <span>250</span>
                  <span>500</span>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
                <p className="text-sm font-medium text-slate-700">Vorschau</p>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-slate-900">
                      {selectedIds.size}
                    </div>
                    <div className="text-xs text-slate-500">Leads ausgewählt</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-900">
                      {dailyLimit}
                    </div>
                    <div className="text-xs text-slate-500">E-Mails/Tag</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-900">
                      {daysNeeded}
                    </div>
                    <div className="text-xs text-slate-500">
                      {daysNeeded === 1 ? "Tag" : "Tage"}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500 text-center">
                  Bei {dailyLimit} E-Mails/Tag dauert das{" "}
                  {daysNeeded === 1
                    ? "einen Tag"
                    : `${daysNeeded} Tage`}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep(1)}
              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Zurück
            </Button>
            <Button
              disabled={!batchName.trim()}
              onClick={() => setStep(3)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Weiter
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Bestätigen & erstellen ── */}
      {step === 3 && (
        <div className="space-y-5">
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-slate-900">
                Zusammenfassung & Bestätigung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-slate-50 border border-slate-200 divide-y divide-slate-200">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Batch-Name</span>
                  <span className="text-sm font-medium text-slate-900">
                    {batchName}
                  </span>
                </div>
                {description && (
                  <div className="flex items-start justify-between px-4 py-3 gap-4">
                    <span className="text-sm text-slate-500 shrink-0">
                      Beschreibung
                    </span>
                    <span className="text-sm text-slate-900 text-right">
                      {description}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">E-Mail-Vorlage</span>
                  <span className="text-sm font-medium text-slate-900">
                    {templateType === "erstkontakt" ? "1. Erstkontakt" : templateType === "followup" ? "2. Follow-up" : "3. Finale E-Mail"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">
                    Ausgewählte Leads
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {selectedIds.size}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Tageslimit</span>
                  <span className="text-sm font-medium text-slate-900">
                    {dailyLimit} E-Mails/Tag
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">
                    Voraussichtliche Dauer
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {daysNeeded === 1 ? "1 Tag" : `${daysNeeded} Tage`}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">
                    Mindest-Score Filter
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {minScore}+
                  </span>
                </div>
              </div>

              {submitError && (
                <div className="flex items-start gap-2 rounded-md bg-red-900/20 border border-red-600/30 p-3">
                  <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-300">{submitError}</p>
                </div>
              )}

              <p className="text-xs text-slate-500">
                Der Batch wird im Status{" "}
                <Badge
                  variant="secondary"
                  className="bg-slate-100 text-slate-700 text-xs"
                >
                  Entwurf
                </Badge>{" "}
                erstellt. Du kannst ihn anschließend aktivieren.
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep(2)}
              disabled={submitting}
              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Zurück
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Batch erstellen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
