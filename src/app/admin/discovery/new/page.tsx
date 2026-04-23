"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, ChevronRight, ChevronLeft, Plus, X, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "logistics",         label: "Logistik",              emoji: "🚛" },
  { value: "warehouse",         label: "Lager / Halle",         emoji: "🏭" },
  { value: "cold_storage",      label: "Kühlhaus",              emoji: "❄️" },
  { value: "supermarket",       label: "Supermarkt",            emoji: "🛒" },
  { value: "food_production",   label: "Lebensmittelproduktion",emoji: "🍔" },
  { value: "manufacturing",     label: "Fertigung",             emoji: "⚙️" },
  { value: "metalworking",      label: "Metallverarbeitung",    emoji: "🔩" },
  { value: "car_dealership",    label: "Autohaus",              emoji: "🚗" },
  { value: "hotel",             label: "Hotel",                 emoji: "🏨" },
  { value: "furniture_store",   label: "Möbelhaus",             emoji: "🛋️" },
  { value: "hardware_store",    label: "Baumarkt",              emoji: "🔨" },
  { value: "shopping_center",   label: "Einkaufszentrum",       emoji: "🏬" },
];

const GERMAN_CITIES = [
  "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main",
  "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen",
  "Bremen", "Dresden", "Hannover", "Nürnberg", "Duisburg",
  "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster",
];

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { n: 1, label: "Kampagne" },
    { n: 2, label: "Gebiete" },
    { n: 3, label: "Branchen" },
    { n: 4, label: "Bestätigen" },
  ];

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((step, i) => (
        <div key={step.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                step.n < current
                  ? "text-[#1F3D2E]"
                  : step.n === current
                  ? "text-[#1F3D2E]"
                  : "bg-slate-800 text-slate-500"
              )}
              style={step.n <= current ? { backgroundColor: "#B2D082" } : undefined}
            >
              {step.n < current ? <CheckCircle2 className="h-4 w-4" /> : step.n}
            </div>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                step.n === current ? "text-white font-medium" : "text-slate-500"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "h-0.5 w-12 mx-1 mb-5 transition-all",
                step.n < current ? "bg-[#B2D082]" : "bg-slate-700"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── City Chip Input ──────────────────────────────────────────────────────────

function CityChipInput({
  areas,
  onChange,
}: {
  areas: { value: string }[];
  onChange: (areas: { value: string }[]) => void;
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  function handleInput(val: string) {
    setInput(val);
    if (val.length >= 2) {
      const lower = val.toLowerCase();
      setSuggestions(
        GERMAN_CITIES.filter(
          (c) =>
            c.toLowerCase().includes(lower) &&
            !areas.find((a) => a.value === c)
        ).slice(0, 5)
      );
    } else {
      setSuggestions([]);
    }
  }

  function addCity(city: string) {
    const trimmed = city.trim();
    if (!trimmed) return;
    if (areas.find((a) => a.value === trimmed)) return;
    onChange([...areas, { value: trimmed }]);
    setInput("");
    setSuggestions([]);
  }

  function removeCity(city: string) {
    onChange(areas.filter((a) => a.value !== city));
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          placeholder="Stadt eingeben (z.B. München)…"
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0) addCity(suggestions[0]);
              else if (input.trim()) addCity(input.trim());
            }
          }}
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-slate-700 transition-colors"
                onClick={() => addCity(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {areas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {areas.map((a) => (
            <span
              key={a.value}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium text-[#1F3D2E]"
              style={{ backgroundColor: "#B2D082" }}
            >
              {a.value}
              <button
                type="button"
                onClick={() => removeCity(a.value)}
                className="ml-1 hover:opacity-70 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Quick-add buttons */}
      <div className="flex flex-wrap gap-2 mt-2">
        {GERMAN_CITIES.filter((c) => !areas.find((a) => a.value === c))
          .slice(0, 8)
          .map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => addCity(c)}
              className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
            >
              + {c}
            </button>
          ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewDiscoveryCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [autoApproveThreshold, setAutoApproveThreshold] = useState("");
  const [areas, setAreas] = useState<{ value: string }[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          areas,
          categories,
          search_keyword: searchKeyword.trim() || undefined,
          auto_approve_threshold: autoApproveThreshold
            ? Number(autoApproveThreshold)
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");
      router.push(`/admin/discovery/${data.campaign.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fehler beim Erstellen");
      setSubmitting(false);
    }
  }

  const canNext1 = name.trim().length >= 3;
  const canNext2 = areas.length >= 1;
  const canNext3 = categories.length >= 1;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-[#B2D082]" />
        <div>
          <h1 className="text-xl font-bold text-white">Neue Discovery-Kampagne</h1>
          <p className="text-slate-400 text-sm">
            Gebiete &amp; Branchen auswählen — System sucht automatisch geeignete Leads
          </p>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Campaign Name ─────────────────────────────────── */}
      {step === 1 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Kampagne benennen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Name <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="z.B. Bayern Q3 2026 – Industrie"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Beschreibung (optional)</label>
              <Input
                placeholder="Kurze interne Notiz…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Zusätzlicher Suchbegriff (optional)
              </label>
              <Input
                placeholder="z.B. Industrie, Gewerbe…"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Wird an jeden Suchbegriff angehängt (z.B. „Logistik Gewerbe München")
              </p>
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Auto-Genehmigungsschwelle (optional)
              </label>
              <Input
                type="number"
                placeholder="z.B. 70 (Score ≥ 70 → automatisch genehmigt)"
                value={autoApproveThreshold}
                onChange={(e) => setAutoApproveThreshold(e.target.value)}
                min={0}
                max={100}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Leads mit einem Score ≥ diesem Wert werden automatisch in den Outreach-Pool übernommen
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Areas ─────────────────────────────────────────── */}
      {step === 2 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Suchgebiete auswählen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-400 mb-4">
              Städte hinzufügen in denen nach passenden Gebäuden gesucht werden soll.
            </p>
            <CityChipInput areas={areas} onChange={setAreas} />
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Categories ────────────────────────────────────── */}
      {step === 3 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Branchen auswählen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-400 mb-4">
              Wähle eine oder mehrere Branchen. Das System sucht in jeder Branche × Gebiet.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORY_OPTIONS.map((cat) => {
                const selected = categories.includes(cat.value);
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => toggleCategory(cat.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg p-3 text-sm font-medium border transition-all",
                      selected
                        ? "border-[#B2D082] text-[#1F3D2E]"
                        : "border-slate-700 text-slate-300 hover:border-slate-500 bg-slate-800/50"
                    )}
                    style={selected ? { backgroundColor: "#B2D082" } : undefined}
                  >
                    <span className="text-xl">{cat.emoji}</span>
                    <span className="text-xs text-center leading-tight">{cat.label}</span>
                  </button>
                );
              })}
            </div>
            {categories.length > 0 && (
              <p className="text-xs text-slate-400 mt-3">
                {categories.length} Branche{categories.length !== 1 ? "n" : ""} × {areas.length} Gebiet{areas.length !== 1 ? "e" : ""} ={" "}
                <span className="text-white font-medium">
                  bis zu {categories.length * areas.length * 60} Ergebnisse
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Confirm ───────────────────────────────────────── */}
      {step === 4 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Zusammenfassung &amp; Starten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-slate-800 p-4 space-y-3 text-sm">
              <Row label="Kampagnenname" value={name} />
              {description && <Row label="Beschreibung" value={description} />}
              <Row
                label="Gebiete"
                value={areas.map((a) => a.value).join(", ")}
              />
              <Row
                label="Branchen"
                value={
                  categories
                    .map((c) => CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c)
                    .join(", ")
                }
              />
              {searchKeyword && <Row label="Suchbegriff" value={searchKeyword} />}
              {autoApproveThreshold && (
                <Row label="Auto-Genehmigung" value={`Score ≥ ${autoApproveThreshold}`} />
              )}
              <div className="border-t border-slate-700 pt-3">
                <Row
                  label="Geschätzte Suchen"
                  value={`${categories.length * areas.length} (bis zu ${categories.length * areas.length * 60} Gebäude)`}
                  highlight
                />
              </div>
            </div>
            <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-3 text-xs text-yellow-300/80">
              Die Kampagne startet sofort und läuft im Hintergrund. API-Abrufe dauern je nach
              Umfang einige Minuten. Du kannst den Status auf der Übersichtsseite verfolgen.
            </div>
            {error && (
              <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-xs text-red-300">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 1 ? router.push("/admin/discovery") : setStep(step - 1))}
          className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {step === 1 ? "Abbrechen" : "Zurück"}
        </Button>

        {step < 4 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={
              (step === 1 && !canNext1) ||
              (step === 2 && !canNext2) ||
              (step === 3 && !canNext3)
            }
            className="text-[#1F3D2E] font-semibold"
            style={{ backgroundColor: "#B2D082" }}
          >
            Weiter
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="text-[#1F3D2E] font-semibold"
            style={{ backgroundColor: "#B2D082" }}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Wird gestartet…
              </>
            ) : (
              <>
                <Radar className="h-4 w-4 mr-2" />
                Kampagne starten
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-slate-400 w-36 shrink-0">{label}</span>
      <span className={highlight ? "text-[#B2D082] font-medium" : "text-white"}>{value}</span>
    </div>
  );
}
