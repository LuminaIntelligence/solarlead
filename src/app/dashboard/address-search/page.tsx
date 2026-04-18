"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  MapPin,
  Search,
  Loader2,
  Sun,
  Zap,
  BarChart2,
  Leaf,
  Save,
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

interface Suggestion {
  place_id: string;
  description: string;
}

interface GeocodedAddress {
  place_id: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  city: string;
  postal_code: string;
  country: string;
}

interface SolarResult {
  solar_quality: string | null;
  max_array_panels_count: number | null;
  max_array_area_m2: number | null;
  annual_energy_kwh: number | null;
  sunshine_hours: number | null;
  carbon_offset: number | null;
  segment_count: number | null;
  panel_capacity_watts: number | null;
}

type PageStatus =
  | "idle"
  | "loading-suggestions"
  | "geocoding"
  | "solar-loading"
  | "solar-done"
  | "solar-disqualified"
  | "solar-error"
  | "saving"
  | "saved";

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
  { value: "other", label: "Sonstiges" },
];

function solarQualityLabel(q: string | null): string {
  switch (q) {
    case "HIGH": return "Hoch";
    case "MEDIUM": return "Mittel";
    case "LOW": return "Niedrig";
    default: return q ?? "–";
  }
}

function solarQualityColor(q: string | null): string {
  switch (q) {
    case "HIGH": return "bg-green-100 text-green-800";
    case "MEDIUM": return "bg-yellow-100 text-yellow-800";
    case "LOW": return "bg-red-100 text-red-800";
    default: return "bg-slate-100 text-slate-600";
  }
}

function calculateKwp(panels: number | null, watts: number | null): string {
  if (!panels) return "–";
  const w = watts ?? 400;
  return ((panels * w) / 1000).toFixed(1) + " kWp";
}

export default function AddressSearchPage() {
  const { toast } = useToast();

  // Eingabe
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [status, setStatus] = useState<PageStatus>("idle");

  // Ergebnis
  const [geocoded, setGeocoded] = useState<GeocodedAddress | null>(null);
  const [solarResult, setSolarResult] = useState<SolarResult | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);

  // Lead-Formular
  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("other");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dropdown schließen bei Klick außerhalb
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Autocomplete-Vorschläge abrufen (debounced)
  const fetchSuggestions = useCallback(async (value: string) => {
    if (value.trim().length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(value.trim())}`
      );
      if (!res.ok) return;
      const data: Suggestion[] = await res.json();
      setSuggestions(data);
      setShowDropdown(data.length > 0);
    } catch {
      // Stille Fehler bei Autocomplete
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Ergebnis zurücksetzen wenn Nutzer tippt
    if (geocoded) {
      setGeocoded(null);
      setSolarResult(null);
      setSavedLeadId(null);
      setStatus("idle");
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  // Adresse auswählen → Geocoding + Solar-Analyse
  const handleSelectSuggestion = async (suggestion: Suggestion) => {
    setQuery(suggestion.description);
    setShowDropdown(false);
    setSuggestions([]);
    setStatus("geocoding");
    setSolarResult(null);
    setSavedLeadId(null);

    try {
      // 1. Geocodierung
      const geoRes = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: suggestion.place_id }),
      });

      if (!geoRes.ok) {
        throw new Error("Geocodierung fehlgeschlagen");
      }

      const geo: GeocodedAddress = await geoRes.json();
      setGeocoded(geo);

      // Vorschlag für Firmenname: leer lassen, nur Platzhalter
      setCompanyName("");

      // 2. Solar-Analyse: zuerst temporären Lead anlegen
      setStatus("solar-loading");

      // Temporären Lead erstellen
      const leadRes = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: `Adresssuche: ${geo.formatted_address}`,
          category: "other",
          address: geo.formatted_address,
          city: geo.city || "",
          postal_code: geo.postal_code || null,
          country: geo.country || "DE",
          latitude: geo.latitude,
          longitude: geo.longitude,
          place_id: null,
          website: null,
          phone: null,
          email: null,
          source: "manual",
        }),
      });

      if (!leadRes.ok) throw new Error("Lead konnte nicht erstellt werden");

      const tempLead = await leadRes.json();
      if (!tempLead?.id) {
        throw new Error("Lead nicht gespeichert");
      }

      const tempLeadId: string = tempLead.id;
      setSavedLeadId(tempLeadId);

      // 3. Solar-API aufrufen
      const solarRes = await fetch("/api/solar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: tempLeadId,
          latitude: geo.latitude,
          longitude: geo.longitude,
        }),
      });

      if (!solarRes.ok) throw new Error("Solar-Analyse fehlgeschlagen");

      const solarData = await solarRes.json();

      // Dachfläche zu klein → Lead wurde serverseitig bereits gelöscht
      if (solarData.disqualified) {
        setSavedLeadId(null);
        setStatus("solar-disqualified");
        toast({
          title: "Dachfläche zu klein",
          description: solarData.message,
          variant: "destructive",
        });
        return;
      }

      setSolarResult(solarData.assessment);
      setStatus("solar-done");
    } catch (error) {
      console.error("[AddressSearch]", error);
      setStatus("solar-error");
      toast({
        title: "Fehler bei der Analyse",
        description:
          error instanceof Error
            ? error.message
            : "Die Adresse konnte nicht analysiert werden.",
        variant: "destructive",
      });
    }
  };

  // Lead mit richtigem Namen + Kategorie aktualisieren
  const handleSaveLead = async () => {
    if (!savedLeadId || !geocoded) return;

    setStatus("saving");

    try {
      const res = await fetch(`/api/leads/${savedLeadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name:
            companyName.trim() || `Adresssuche: ${geocoded.formatted_address}`,
          category,
          address: geocoded.formatted_address,
          city: geocoded.city,
          postal_code: geocoded.postal_code,
        }),
      });

      if (!res.ok) throw new Error("Aktualisierung fehlgeschlagen");

      setStatus("saved");
      toast({
        title: "Lead gespeichert",
        description:
          companyName.trim()
            ? `${companyName} wurde in Ihrer Pipeline gespeichert.`
            : "Adresse wurde in Ihrer Pipeline gespeichert.",
      });
    } catch (error) {
      setStatus("solar-done"); // Zurück zum Solar-Ergebnis
      toast({
        title: "Fehler beim Speichern",
        description:
          error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
        variant: "destructive",
      });
    }
  };

  const isLoading =
    status === "geocoding" ||
    status === "solar-loading" ||
    status === "saving";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Adresssuche</h1>
        <p className="text-muted-foreground">
          Direkt eine Adresse eingeben und das Solarpotenzial des Gebäudes
          analysieren.
        </p>
      </div>

      {/* Suchbereich */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-green-600" />
            Adresse eingeben
          </CardTitle>
          <CardDescription>
            Geben Sie eine Straße, Stadt oder Adresse ein – wie in Google Maps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-2xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="z.B. Musterstraße 1, München..."
                value={query}
                onChange={handleInputChange}
                onFocus={() => {
                  if (suggestions.length > 0) setShowDropdown(true);
                }}
                className="pl-9 pr-4 h-12 text-base"
                disabled={isLoading}
              />
              {isLoading && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Autocomplete-Dropdown */}
            {showDropdown && suggestions.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 transition-colors first:rounded-t-md last:rounded-b-md"
                    onMouseDown={(e) => {
                      e.preventDefault(); // Verhindert blur
                      handleSelectSuggestion(s);
                    }}
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>{s.description}</span>
                  </button>
                ))}
                <div className="flex items-center justify-end border-t px-3 py-1.5">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <ChevronDown className="h-3 w-3" />
                    Vorschläge auswählen
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Status-Meldung */}
          {status === "geocoding" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Adresse wird geocodiert...
            </div>
          )}
          {status === "solar-loading" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Solar-Potenzial wird analysiert...
            </div>
          )}
          {status === "solar-error" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
              <XCircle className="h-4 w-4" />
              Analyse fehlgeschlagen. Bitte versuchen Sie eine andere Adresse.
            </div>
          )}
          {status === "solar-disqualified" && geocoded && (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-orange-800">Dachfläche zu klein – kein Lead erstellt</p>
                  <p className="text-sm text-orange-700 mt-1">
                    GreenScout benötigt mindestens <strong>500 m²</strong> nutzbare Dachfläche.
                    Diese Adresse erfüllt das Kriterium nicht und wurde nicht in die Pipeline aufgenommen.
                  </p>
                  <p className="text-xs text-orange-600 mt-2">{geocoded.formatted_address}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ergebnisse */}
      {(status === "solar-done" || status === "saving" || status === "saved") &&
        geocoded &&
        solarResult && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Solar-Analyse */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sun className="h-5 w-5 text-yellow-500" />
                  Solar-Analyse
                </CardTitle>
                <CardDescription className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {geocoded.formatted_address}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Qualitäts-Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Solar-Qualität
                  </span>
                  <Badge
                    className={solarQualityColor(solarResult.solar_quality)}
                    variant="secondary"
                  >
                    {solarQualityLabel(solarResult.solar_quality)}
                  </Badge>
                </div>

                {/* Kennzahlen */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Sun className="h-3.5 w-3.5 text-yellow-500" />
                      Anlagenleistung
                    </div>
                    <p className="text-xl font-bold text-slate-900">
                      {calculateKwp(
                        solarResult.max_array_panels_count,
                        solarResult.panel_capacity_watts
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {solarResult.max_array_panels_count ?? "–"} Module
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <BarChart2 className="h-3.5 w-3.5 text-blue-500" />
                      Dachfläche
                    </div>
                    <p className="text-xl font-bold text-slate-900">
                      {solarResult.max_array_area_m2
                        ? `${Math.round(solarResult.max_array_area_m2)} m²`
                        : "–"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {solarResult.segment_count ?? "–"} Dachsegmente
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Zap className="h-3.5 w-3.5 text-green-500" />
                      Jahresertrag
                    </div>
                    <p className="text-xl font-bold text-slate-900">
                      {solarResult.annual_energy_kwh
                        ? `${Math.round(solarResult.annual_energy_kwh).toLocaleString("de-DE")} kWh`
                        : "–"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      pro Jahr
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Leaf className="h-3.5 w-3.5 text-green-600" />
                      CO₂-Einsparung
                    </div>
                    <p className="text-xl font-bold text-slate-900">
                      {solarResult.carbon_offset
                        ? `${Math.round(solarResult.carbon_offset).toLocaleString("de-DE")} kg`
                        : "–"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      pro Jahr
                    </p>
                  </div>
                </div>

                {/* Sonnenstunden */}
                {solarResult.sunshine_hours && (
                  <div className="flex items-center justify-between border-t pt-3 text-sm">
                    <span className="text-muted-foreground">
                      Sonnenstunden / Jahr
                    </span>
                    <span className="font-medium">
                      {Math.round(solarResult.sunshine_hours).toLocaleString(
                        "de-DE"
                      )}{" "}
                      h
                    </span>
                  </div>
                )}

                {/* Koordinaten */}
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Koordinaten</span>
                  <span>
                    {geocoded.latitude.toFixed(4)},{" "}
                    {geocoded.longitude.toFixed(4)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Als Lead speichern */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Save className="h-5 w-5 text-green-600" />
                  Als Lead speichern
                </CardTitle>
                <CardDescription>
                  Fügen Sie diese Adresse als Lead zur Pipeline hinzu.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {status === "saved" ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
                    <p className="font-medium text-slate-900">
                      Lead gespeichert!
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {companyName.trim() || "Die Adresse"} wurde Ihrer Pipeline
                      hinzugefügt.
                    </p>
                    <div className="mt-4 flex gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (savedLeadId) {
                            window.location.href = `/dashboard/leads/${savedLeadId}`;
                          }
                        }}
                      >
                        Lead öffnen
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setQuery("");
                          setGeocoded(null);
                          setSolarResult(null);
                          setSavedLeadId(null);
                          setStatus("idle");
                          setCompanyName("");
                          setCategory("other");
                        }}
                      >
                        Neue Adresse suchen
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="company-name">
                        Unternehmensname{" "}
                        <span className="text-muted-foreground font-normal">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="company-name"
                        placeholder="Firmenname eingeben..."
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        disabled={status === "saving"}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Kategorie</Label>
                      <Select
                        value={category}
                        onValueChange={setCategory}
                        disabled={status === "saving"}
                      >
                        <SelectTrigger id="category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Adressvorschau */}
                    <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                      <p className="text-xs text-muted-foreground mb-1">
                        Adresse
                      </p>
                      <p className="font-medium text-slate-800">
                        {geocoded.formatted_address}
                      </p>
                      {geocoded.city && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {geocoded.postal_code} {geocoded.city},{" "}
                          {geocoded.country}
                        </p>
                      )}
                    </div>

                    <Button
                      className="w-full"
                      onClick={handleSaveLead}
                      disabled={status === "saving"}
                    >
                      {status === "saving" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Wird gespeichert...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          In Pipeline speichern
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

      {/* Leerzustand */}
      {status === "idle" && (
        <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-white">
          <div className="text-center">
            <MapPin className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-4 text-lg font-medium text-slate-600">
              Adresse eingeben und Solar-Potenzial entdecken
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Tippen Sie eine Adresse in das Suchfeld – Vorschläge erscheinen
              automatisch.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
