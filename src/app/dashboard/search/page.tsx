"use client";

import { useState, useCallback } from "react";
import {
  Search,
  Loader2,
  Globe,
  Phone,
  MapPin,
  CheckSquare,
  Square,
  Save,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { SearchResult } from "@/lib/providers/search/types";

const COUNTRIES = [
  { value: "DE", label: "Deutschland" },
  { value: "AT", label: "Österreich" },
  { value: "CH", label: "Schweiz" },
  { value: "NL", label: "Niederlande" },
  { value: "BE", label: "Belgien" },
  { value: "FR", label: "Frankreich" },
  { value: "IT", label: "Italien" },
  { value: "ES", label: "Spanien" },
  { value: "PL", label: "Polen" },
  { value: "CZ", label: "Tschechien" },
];

const RADIUS_OPTIONS = [
  { value: "5", label: "5 km" },
  { value: "10", label: "10 km" },
  { value: "25", label: "25 km" },
  { value: "50", label: "50 km" },
  { value: "100", label: "100 km" },
];

const CATEGORIES = [
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

type SaveStatus = "idle" | "saving" | "enriching" | "solar" | "scoring" | "done" | "error" | "disqualified";

interface ResultWithSelection extends SearchResult {
  _selected: boolean;
  _saveStatus: SaveStatus;
  _savedLeadId?: string;
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function SearchPage() {
  const { toast } = useToast();

  // Search form state
  const [country, setCountry] = useState("DE");
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState("25");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");

  // Results state
  const [results, setResults] = useState<ResultWithSelection[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [bulkSaveStatus, setBulkSaveStatus] = useState<SaveStatus>("idle");

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const toggleSelect = (index: number) => {
    setResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, _selected: !r._selected } : r))
    );
  };

  const toggleSelectAll = () => {
    const allSelected = results.every((r) => r._selected);
    setResults((prev) => prev.map((r) => ({ ...r, _selected: !allSelected })));
  };

  const selectedCount = results.filter((r) => r._selected).length;

  // --- Search ---
  const handleSearch = async () => {
    if (!city.trim()) {
      toast({ title: "Stadt erforderlich", description: "Bitte geben Sie eine Stadt oder Region ein.", variant: "destructive" });
      return;
    }
    if (selectedCategories.length === 0) {
      toast({ title: "Kategorie erforderlich", description: "Bitte wählen Sie mindestens eine Geschäftskategorie.", variant: "destructive" });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          city: city.trim(),
          radius_km: Number(radius),
          categories: selectedCategories,
          keywords: keywords.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Suche fehlgeschlagen" }));
        throw new Error(err.error || "Suche fehlgeschlagen");
      }

      const data: SearchResult[] = await res.json();
      setResults(
        data.map((r) => ({ ...r, _selected: false, _saveStatus: "idle" as SaveStatus }))
      );

      if (data.length === 0) {
        toast({ title: "Keine Ergebnisse", description: "Versuchen Sie andere Suchparameter." });
      }
    } catch (err) {
      toast({
        title: "Suchfehler",
        description: err instanceof Error ? err.message : "Ein unerwarteter Fehler ist aufgetreten.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  // --- Save + Enrich + Solar pipeline ---
  const processSavedLead = useCallback(
    async (leadId: string, result: ResultWithSelection, updateStatus: (s: SaveStatus) => void) => {
      // Enrich if website available
      if (result.website) {
        updateStatus("enriching");
        try {
          await fetch("/api/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_id: leadId, website: result.website }),
          });
        } catch {
          // enrichment failure is non-fatal
        }
      }

      // Solar assessment if coordinates available
      if (result.latitude && result.longitude) {
        updateStatus("solar");
        try {
          const solarRes = await fetch("/api/solar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lead_id: leadId,
              latitude: result.latitude,
              longitude: result.longitude,
            }),
          });
          if (solarRes.ok) {
            const solarData = await solarRes.json();
            // Dachfläche zu klein → Lead wurde serverseitig gelöscht
            if (solarData.disqualified) {
              updateStatus("disqualified");
              return;
            }
          }
        } catch {
          // solar failure is non-fatal
        }
      }

      updateStatus("done");
    },
    []
  );

  const saveSingleResult = async (index: number) => {
    const result = results[index];
    if (result._saveStatus !== "idle") return;

    const updateStatus = (status: SaveStatus) => {
      setResults((prev) =>
        prev.map((r, i) => (i === index ? { ...r, _saveStatus: status } : r))
      );
    };

    updateStatus("saving");

    try {
      const res = await fetch("/api/search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: [result] }),
      });

      if (!res.ok) throw new Error("Speichern fehlgeschlagen");

      const { savedLeads } = await res.json();
      if (!savedLeads || savedLeads.length === 0) {
        updateStatus("done");
        toast({ title: "Bereits gespeichert", description: `${result.company_name} ist bereits in Ihrer Pipeline.` });
        return;
      }

      const leadId = savedLeads[0].id;
      setResults((prev) =>
        prev.map((r, i) => (i === index ? { ...r, _savedLeadId: leadId } : r))
      );

      await processSavedLead(leadId, result, updateStatus);
      toast({ title: "Lead gespeichert", description: `${result.company_name} wurde hinzugefügt und verarbeitet.` });
    } catch {
      updateStatus("error");
      toast({ title: "Speichern fehlgeschlagen", description: `${result.company_name} konnte nicht gespeichert werden.`, variant: "destructive" });
    }
  };

  const saveSelectedResults = async (saveAll: boolean) => {
    const toSave = saveAll ? results.filter((r) => r._saveStatus === "idle") : results.filter((r) => r._selected && r._saveStatus === "idle");
    if (toSave.length === 0) {
      toast({ title: "Nichts zu speichern", description: "Keine neuen Ergebnisse zum Speichern." });
      return;
    }

    setBulkSaveStatus("saving");

    try {
      const res = await fetch("/api/search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: toSave }),
      });

      if (!res.ok) throw new Error("Massenweises Speichern fehlgeschlagen");

      const { savedLeads } = await res.json();
      const savedCount = savedLeads?.length ?? 0;

      if (savedCount === 0) {
        setBulkSaveStatus("done");
        toast({ title: "Keine neuen Leads", description: "Alle ausgewählten Ergebnisse sind bereits in Ihrer Pipeline." });
        return;
      }

      // Map saved lead IDs back to results
      const savedMap = new Map<string, string>();
      for (const lead of savedLeads) {
        savedMap.set(lead.place_id || lead.company_name, lead.id);
      }

      // Update results with saved lead IDs
      setResults((prev) =>
        prev.map((r) => {
          const key = r.place_id || r.company_name;
          const leadId = savedMap.get(key);
          if (leadId) {
            return { ...r, _saveStatus: "enriching" as SaveStatus, _savedLeadId: leadId };
          }
          return r;
        })
      );

      // Process enrichment and solar for each saved lead
      setBulkSaveStatus("enriching");
      const enrichPromises: Promise<void>[] = [];

      for (const lead of savedLeads) {
        const matchingResult = toSave.find(
          (r) => (r.place_id && r.place_id === lead.place_id) || r.company_name === lead.company_name
        );
        if (matchingResult) {
          enrichPromises.push(
            processSavedLead(lead.id, matchingResult, (status) => {
              setResults((prev) =>
                prev.map((r) => {
                  const key = r.place_id || r.company_name;
                  if (key === (matchingResult.place_id || matchingResult.company_name)) {
                    return { ...r, _saveStatus: status };
                  }
                  return r;
                })
              );
            })
          );
        }
      }

      await Promise.allSettled(enrichPromises);
      setBulkSaveStatus("done");
      toast({
        title: "Pipeline aktualisiert",
        description: `${savedCount} Lead${savedCount !== 1 ? "s" : ""} erfolgreich gespeichert.`,
      });
    } catch {
      setBulkSaveStatus("error");
      toast({ title: "Speichern fehlgeschlagen", description: "Leads konnten nicht in der Pipeline gespeichert werden.", variant: "destructive" });
    }
  };

  const statusLabel = (status: SaveStatus): string => {
    switch (status) {
      case "saving": return "Wird gespeichert...";
      case "enriching": return "Anreicherung...";
      case "solar": return "Solar-Analyse...";
      case "scoring": return "Bewertung...";
      case "done": return "Gespeichert";
      case "error": return "Fehler";
      case "disqualified": return "Zu kleine Dachfläche";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Lead-Suche</h1>
        <p className="text-muted-foreground">
          Finden Sie Unternehmen für Solaranlagen in Ihrer Zielregion.
        </p>
      </div>

      <div className="flex gap-6">
        {/* ---- Left Panel: Search Form ---- */}
        <div className="w-1/3 shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="h-5 w-5" />
                Suchparameter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Country */}
              <div className="space-y-2">
                <Label htmlFor="country">Land</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="country">
                    <SelectValue placeholder="Land auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* City / Region */}
              <div className="space-y-2">
                <Label htmlFor="city">Stadt / Region</Label>
                <Input
                  id="city"
                  placeholder="z.B. München, Hamburg..."
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>

              {/* Radius */}
              <div className="space-y-2">
                <Label htmlFor="radius">Umkreis</Label>
                <Select value={radius} onValueChange={setRadius}>
                  <SelectTrigger id="radius">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RADIUS_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Business Categories */}
              <div className="space-y-2">
                <Label>Geschäftskategorien</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((cat) => {
                    const checked = selectedCategories.includes(cat.value);
                    return (
                      <label
                        key={cat.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          checked
                            ? "border-green-500 bg-green-50 text-green-800"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCategory(cat.value)}
                          className="sr-only"
                        />
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? "border-green-600 bg-green-600" : "border-slate-300"
                          }`}
                        >
                          {checked && (
                            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        {cat.label}
                      </label>
                    );
                  })}
                </div>
                {selectedCategories.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedCategories.length} Kategorie{selectedCategories.length !== 1 ? "n" : ""} ausgewählt
                  </p>
                )}
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <Label htmlFor="keywords">Stichwörter (optional)</Label>
                <Input
                  id="keywords"
                  placeholder="z.B. Logistikzentrum, Kühlhaus..."
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </div>

              {/* Search Button */}
              <Button
                className="w-full"
                onClick={handleSearch}
                disabled={isSearching}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Suche läuft...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Suchen
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ---- Right Panel: Results ---- */}
        <div className="flex-1 min-w-0">
          {/* Empty state */}
          {!hasSearched && !isSearching && (
            <div className="flex h-96 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-white">
              <div className="text-center">
                <Search className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-4 text-lg font-medium text-slate-600">
                  Konfigurieren Sie die Suche und entdecken Sie Leads
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Wählen Sie eine Region und Geschäftskategorien, um Unternehmen für Solaranlagen zu finden.
                </p>
              </div>
            </div>
          )}

          {/* Loading state */}
          {isSearching && (
            <div className="flex h-96 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <div className="text-center">
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-green-600" />
                <p className="mt-4 text-sm font-medium text-slate-600">
                  Suche nach Unternehmen...
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dies kann je nach Suchgebiet einen Moment dauern.
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {hasSearched && !isSearching && (
            <div className="space-y-4">
              {/* Results header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">
                    {results.length} Ergebnis{results.length !== 1 ? "se" : ""} gefunden
                  </h2>
                  {results.length > 0 && (
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-slate-700 transition-colors"
                    >
                      {results.every((r) => r._selected) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      {results.every((r) => r._selected) ? "Alle abwählen" : "Alle auswählen"}
                    </button>
                  )}
                </div>

                {results.length > 0 && (
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveSelectedResults(false)}
                        disabled={bulkSaveStatus === "saving" || bulkSaveStatus === "enriching"}
                      >
                        {bulkSaveStatus !== "idle" && bulkSaveStatus !== "done" && bulkSaveStatus !== "error" ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-3 w-3" />
                        )}
                        Ausgewählte speichern ({selectedCount})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => saveSelectedResults(true)}
                      disabled={bulkSaveStatus === "saving" || bulkSaveStatus === "enriching"}
                    >
                      {bulkSaveStatus !== "idle" && bulkSaveStatus !== "done" && bulkSaveStatus !== "error" ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-3 w-3" />
                      )}
                      Alle in Pipeline speichern
                    </Button>
                  </div>
                )}
              </div>

              {/* Bulk status bar */}
              {bulkSaveStatus !== "idle" && bulkSaveStatus !== "done" && bulkSaveStatus !== "error" && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {statusLabel(bulkSaveStatus)}
                </div>
              )}
              {bulkSaveStatus === "done" && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Alle Leads erfolgreich gespeichert und verarbeitet.
                </div>
              )}

              {/* No results */}
              {results.length === 0 && (
                <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <div className="text-center">
                    <XCircle className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      Keine Unternehmen gefunden. Versuchen Sie einen anderen Standort oder breitere Kategorien.
                    </p>
                  </div>
                </div>
              )}

              {/* Result cards grid */}
              {results.length > 0 && (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {results.map((result, idx) => (
                    <Card
                      key={`${result.place_id || result.company_name}-${idx}`}
                      className={`relative transition-shadow hover:shadow-md ${
                        result._selected ? "ring-2 ring-green-500 ring-offset-1" : ""
                      } ${result._saveStatus === "done" ? "bg-green-50/50" : ""} ${result._saveStatus === "disqualified" ? "opacity-50" : ""}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <button
                            onClick={() => toggleSelect(idx)}
                            className="mt-0.5 shrink-0 text-slate-400 hover:text-green-600 transition-colors"
                            disabled={result._saveStatus !== "idle"}
                          >
                            {result._selected ? (
                              <CheckSquare className="h-5 w-5 text-green-600" />
                            ) : (
                              <Square className="h-5 w-5" />
                            )}
                          </button>

                          {/* Content */}
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="font-semibold text-slate-900 truncate">
                                  {result.company_name}
                                </h3>
                                <Badge variant="secondary" className="mt-1">
                                  {formatCategory(result.category)}
                                </Badge>
                              </div>

                              {/* Save button / status */}
                              <div className="shrink-0">
                                {result._saveStatus === "idle" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => saveSingleResult(idx)}
                                    className="h-8"
                                  >
                                    <Save className="mr-1.5 h-3 w-3" />
                                    Speichern
                                  </Button>
                                )}
                                {result._saveStatus !== "idle" && result._saveStatus !== "done" && result._saveStatus !== "error" && (
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1.5 rounded-md">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    {statusLabel(result._saveStatus)}
                                  </div>
                                )}
                                {result._saveStatus === "done" && (
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1.5 rounded-md">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Gespeichert
                                  </div>
                                )}
                                {result._saveStatus === "error" && (
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1.5 rounded-md">
                                    <XCircle className="h-3 w-3" />
                                    Fehler
                                  </div>
                                )}
                                {result._saveStatus === "disqualified" && (
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-orange-700 bg-orange-50 px-2.5 py-1.5 rounded-md" title="Dachfläche unter 500 m² – nicht in Pipeline aufgenommen">
                                    <XCircle className="h-3 w-3" />
                                    Dachfläche &lt; 500 m²
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Details */}
                            <div className="space-y-1 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{result.address}</span>
                              </div>
                              {result.website && (
                                <div className="flex items-center gap-1.5">
                                  <Globe className="h-3.5 w-3.5 shrink-0" />
                                  <a
                                    href={result.website.startsWith("http") ? result.website : `https://${result.website}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="truncate text-blue-600 hover:underline"
                                  >
                                    {result.website}
                                  </a>
                                </div>
                              )}
                              {result.phone && (
                                <div className="flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 shrink-0" />
                                  <span>{result.phone}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span>
                                  {result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
