"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Radar, ChevronRight, ChevronLeft, X, CheckCircle2, Loader2, MapPin,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DiscoveryCampaignArea } from "@/types/database";

// ─── Category options ─────────────────────────────────────────────────────────

const CATEGORY_GROUPS = [
  {
    label: "Logistik & Handel",
    items: [
      { value: "logistics",        label: "Logistik",              emoji: "🚛" },
      { value: "warehouse",        label: "Lager / Halle",         emoji: "🏭" },
      { value: "cold_storage",     label: "Kühlhaus",              emoji: "❄️" },
      { value: "wholesale",        label: "Großhandel",            emoji: "📦" },
      { value: "supermarket",      label: "Supermarkt",            emoji: "🛒" },
      { value: "shopping_center",  label: "Einkaufszentrum",       emoji: "🏬" },
      { value: "hardware_store",   label: "Baumarkt",              emoji: "🔨" },
      { value: "furniture_store",  label: "Möbelhaus",             emoji: "🛋️" },
      { value: "car_dealership",   label: "Autohaus",              emoji: "🚗" },
    ],
  },
  {
    label: "Industrie & Produktion",
    items: [
      { value: "manufacturing",    label: "Fertigung",             emoji: "⚙️" },
      { value: "metalworking",     label: "Metallverarbeitung",    emoji: "🔩" },
      { value: "food_production",  label: "Lebensmittel",          emoji: "🍔" },
      { value: "wood_processing",  label: "Holzverarbeitung",      emoji: "🪵" },
      { value: "plastics",         label: "Kunststofftechnik",     emoji: "🔧" },
      { value: "printing",         label: "Druckerei",             emoji: "🖨️" },
      { value: "brewery",          label: "Brauerei / Getränke",   emoji: "🍺" },
      { value: "recycling",        label: "Recycling / Entsorgung",emoji: "♻️" },
    ],
  },
  {
    label: "Agrar & Gewächshaus",
    items: [
      { value: "farm",             label: "Landwirtschaft",        emoji: "🌾" },
      { value: "greenhouse",       label: "Gewächshaus",           emoji: "🌱" },
    ],
  },
  {
    label: "Öffentlich & Sozial",
    items: [
      { value: "hospital",         label: "Klinik / Krankenhaus",  emoji: "🏥" },
      { value: "swimming_pool",    label: "Hallenbad / Freibad",   emoji: "🏊" },
      { value: "sports_hall",      label: "Sporthalle",            emoji: "🏟️" },
      { value: "school",           label: "Schule / Bildung",      emoji: "🏫" },
      { value: "events_hall",      label: "Veranstaltungshalle",   emoji: "🎪" },
      { value: "church",           label: "Kirche / Gemeinde",     emoji: "⛪" },
    ],
  },
  {
    label: "Dienstleistungen",
    items: [
      { value: "hotel",            label: "Hotel",                 emoji: "🏨" },
      { value: "laundry",          label: "Wäscherei",             emoji: "👕" },
      { value: "data_center",      label: "Rechenzentrum",         emoji: "🖥️" },
      { value: "gas_station",      label: "Tankstelle",            emoji: "⛽" },
      { value: "car_park",         label: "Parkhaus",              emoji: "🅿️" },
    ],
  },
];

// Flat list for lookups (summary display, etc.)
const CATEGORY_OPTIONS = CATEGORY_GROUPS.flatMap((g) => g.items);

// ─── Coordinate lookup for custom radius search ───────────────────────────────

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "München":             { lat: 48.137, lng: 11.576 },
  "Berlin":              { lat: 52.520, lng: 13.405 },
  "Hamburg":             { lat: 53.551, lng:  9.993 },
  "Köln":                { lat: 50.938, lng:  6.960 },
  "Frankfurt am Main":   { lat: 50.110, lng:  8.682 },
  "Stuttgart":           { lat: 48.775, lng:  9.182 },
  "Düsseldorf":          { lat: 51.226, lng:  6.773 },
  "Leipzig":             { lat: 51.340, lng: 12.374 },
  "Dortmund":            { lat: 51.514, lng:  7.465 },
  "Essen":               { lat: 51.456, lng:  7.011 },
  "Bremen":              { lat: 53.073, lng:  8.806 },
  "Dresden":             { lat: 51.051, lng: 13.738 },
  "Hannover":            { lat: 52.374, lng:  9.738 },
  "Nürnberg":            { lat: 49.452, lng: 11.077 },
  "Duisburg":            { lat: 51.434, lng:  6.762 },
  "Bochum":              { lat: 51.481, lng:  7.219 },
  "Wuppertal":           { lat: 51.257, lng:  7.151 },
  "Bielefeld":           { lat: 52.021, lng:  8.532 },
  "Bonn":                { lat: 50.735, lng:  7.100 },
  "Münster":             { lat: 51.962, lng:  7.626 },
  "Karlsruhe":           { lat: 49.008, lng:  8.404 },
  "Mannheim":            { lat: 49.487, lng:  8.466 },
  "Augsburg":            { lat: 48.370, lng: 10.898 },
  "Wiesbaden":           { lat: 50.079, lng:  8.244 },
  "Aachen":              { lat: 50.776, lng:  6.084 },
  "Braunschweig":        { lat: 52.268, lng: 10.527 },
  "Chemnitz":            { lat: 50.833, lng: 12.924 },
  "Kiel":                { lat: 54.323, lng: 10.123 },
  "Erfurt":              { lat: 50.984, lng: 11.029 },
  "Mainz":               { lat: 49.999, lng:  8.273 },
  "Rostock":             { lat: 54.092, lng: 12.099 },
  "Kassel":              { lat: 51.312, lng:  9.481 },
  "Regensburg":          { lat: 49.013, lng: 12.102 },
  "Ingolstadt":          { lat: 48.763, lng: 11.424 },
  "Würzburg":            { lat: 49.795, lng:  9.936 },
  "Wolfsburg":           { lat: 52.422, lng: 10.787 },
  "Heilbronn":           { lat: 49.142, lng:  9.218 },
  "Ulm":                 { lat: 48.401, lng:  9.987 },
  "Freiburg im Breisgau":{ lat: 47.999, lng:  7.842 },
  "Heidelberg":          { lat: 49.399, lng:  8.673 },
  "Osnabrück":           { lat: 52.279, lng:  8.047 },
  "Oldenburg":           { lat: 53.143, lng:  8.214 },
  "Göttingen":           { lat: 51.541, lng:  9.916 },
  "Magdeburg":           { lat: 52.130, lng: 11.628 },
  "Halle an der Saale":  { lat: 51.482, lng: 11.970 },
  "Potsdam":             { lat: 52.396, lng: 13.060 },
  "Saarbrücken":         { lat: 49.235, lng:  7.004 },
  "Lübeck":              { lat: 53.869, lng: 10.686 },
};

const CITY_NAMES = Object.keys(CITY_COORDS);

// ─── Region definitions (coordinate circles) ─────────────────────────────────
// Each region = array of search circles. Together they cover the full area
// including small towns like Herzogenaurach (20 km from Nürnberg).
// API restriction: max 50 km radius per call. Large regions use multiple circles.

interface SearchCircle {
  label: string;   // city center name (internal)
  lat: number;
  lng: number;
  km: number;      // radius in km (max 50 for API)
}

interface RegionDef {
  label: string;
  emoji: string;
  description: string;
  circles: SearchCircle[];
}

const REGIONS: RegionDef[] = [
  {
    label: "Bayern",
    emoji: "🦁",
    description: "Ganz Bayern inkl. kleiner Orte",
    circles: [
      { label: "München",     lat: 48.137, lng: 11.576, km: 50 },
      { label: "Augsburg",    lat: 48.370, lng: 10.898, km: 35 },
      { label: "Ingolstadt",  lat: 48.763, lng: 11.424, km: 35 },
      { label: "Nürnberg",    lat: 49.452, lng: 11.077, km: 50 }, // deckt Herzogenaurach, Erlangen, Fürth
      { label: "Würzburg",    lat: 49.795, lng:  9.936, km: 45 },
      { label: "Regensburg",  lat: 49.013, lng: 12.102, km: 50 },
      { label: "Passau",      lat: 48.574, lng: 13.458, km: 40 },
      { label: "Rosenheim",   lat: 47.857, lng: 12.128, km: 35 },
    ],
  },
  {
    label: "Franken",
    emoji: "🏰",
    description: "Nürnberg, Würzburg & Umgebung",
    circles: [
      { label: "Nürnberg",   lat: 49.452, lng: 11.077, km: 50 }, // Herzogenaurach, Erlangen, Fürth, Schwabach, Roth
      { label: "Würzburg",   lat: 49.795, lng:  9.936, km: 45 }, // Schweinfurt, Kitzingen, Bad Kissingen
      { label: "Bamberg",    lat: 49.898, lng: 10.904, km: 35 },
      { label: "Bayreuth",   lat: 49.945, lng: 11.578, km: 35 },
      { label: "Ansbach",    lat: 49.301, lng: 10.572, km: 35 },
    ],
  },
  {
    label: "Schwaben (BY)",
    emoji: "⚙️",
    description: "Augsburg, Kempten & Allgäu",
    circles: [
      { label: "Augsburg",   lat: 48.370, lng: 10.898, km: 45 },
      { label: "Kempten",    lat: 47.726, lng: 10.317, km: 40 },
      { label: "Neu-Ulm",    lat: 48.396, lng: 10.014, km: 35 },
    ],
  },
  {
    label: "NRW",
    emoji: "🏭",
    description: "Rheinland, Ruhrgebiet & Münsterland",
    circles: [
      { label: "Köln",       lat: 50.938, lng:  6.960, km: 50 },
      { label: "Düsseldorf", lat: 51.226, lng:  6.773, km: 35 },
      { label: "Dortmund",   lat: 51.514, lng:  7.465, km: 40 },
      { label: "Essen",      lat: 51.456, lng:  7.011, km: 30 },
      { label: "Bochum",     lat: 51.481, lng:  7.219, km: 25 },
      { label: "Münster",    lat: 51.962, lng:  7.626, km: 40 },
      { label: "Bielefeld",  lat: 52.021, lng:  8.532, km: 35 },
      { label: "Aachen",     lat: 50.776, lng:  6.084, km: 35 },
    ],
  },
  {
    label: "Ruhrgebiet",
    emoji: "🔩",
    description: "Industrieherz NRW",
    circles: [
      { label: "Dortmund",   lat: 51.514, lng:  7.465, km: 35 },
      { label: "Essen",      lat: 51.456, lng:  7.011, km: 30 },
      { label: "Duisburg",   lat: 51.434, lng:  6.762, km: 30 },
      { label: "Bochum",     lat: 51.481, lng:  7.219, km: 25 },
    ],
  },
  {
    label: "Baden-Württemberg",
    emoji: "🌲",
    description: "Stuttgart, Karlsruhe, Freiburg",
    circles: [
      { label: "Stuttgart",  lat: 48.775, lng:  9.182, km: 50 },
      { label: "Karlsruhe",  lat: 49.008, lng:  8.404, km: 40 },
      { label: "Freiburg",   lat: 47.999, lng:  7.842, km: 40 },
      { label: "Ulm",        lat: 48.401, lng:  9.987, km: 40 },
    ],
  },
  {
    label: "Hessen",
    emoji: "🏦",
    description: "Frankfurt, Wiesbaden & Kassel",
    circles: [
      { label: "Frankfurt",  lat: 50.110, lng:  8.682, km: 50 },
      { label: "Kassel",     lat: 51.312, lng:  9.481, km: 40 },
    ],
  },
  {
    label: "Niedersachsen",
    emoji: "🐎",
    description: "Hannover, Braunschweig & Osnabrück",
    circles: [
      { label: "Hannover",   lat: 52.374, lng:  9.738, km: 50 },
      { label: "Braunschweig",lat:52.268, lng: 10.527, km: 40 },
      { label: "Osnabrück",  lat: 52.279, lng:  8.047, km: 40 },
    ],
  },
  {
    label: "Sachsen",
    emoji: "⛏️",
    description: "Dresden, Leipzig & Chemnitz",
    circles: [
      { label: "Leipzig",    lat: 51.340, lng: 12.374, km: 40 },
      { label: "Dresden",    lat: 51.051, lng: 13.738, km: 40 },
      { label: "Chemnitz",   lat: 50.833, lng: 12.924, km: 35 },
    ],
  },
  {
    label: "Thüringen",
    emoji: "🌳",
    description: "Erfurt, Jena & Weimar",
    circles: [
      { label: "Erfurt",     lat: 50.984, lng: 11.029, km: 45 },
    ],
  },
  {
    label: "Brandenburg & Berlin",
    emoji: "🐻",
    description: "Berlin und Umland",
    circles: [
      { label: "Berlin",     lat: 52.520, lng: 13.405, km: 50 },
    ],
  },
  {
    label: "Rheinland-Pfalz",
    emoji: "🍷",
    description: "Mainz, Koblenz & Trier",
    circles: [
      { label: "Mainz",      lat: 49.999, lng:  8.273, km: 40 },
      { label: "Koblenz",    lat: 50.361, lng:  7.590, km: 35 },
      { label: "Trier",      lat: 49.749, lng:  6.637, km: 35 },
    ],
  },
  {
    label: "Norddeutschland",
    emoji: "⚓",
    description: "Hamburg, Bremen, Kiel, Rostock",
    circles: [
      { label: "Hamburg",    lat: 53.551, lng:  9.993, km: 50 },
      { label: "Bremen",     lat: 53.073, lng:  8.806, km: 40 },
      { label: "Kiel",       lat: 54.323, lng: 10.123, km: 40 },
      { label: "Rostock",    lat: 54.092, lng: 12.099, km: 35 },
    ],
  },
];

/** Convert region circles to DiscoveryCampaignArea array */
function regionToAreas(region: RegionDef): DiscoveryCampaignArea[] {
  return region.circles.map((c) => ({
    type: "radius" as const,
    value: `${c.label} (${c.km} km)`,
    lat: c.lat,
    lng: c.lng,
    radius_km: c.km,
  }));
}

/** Check which area keys a region contributes */
function regionAreaKeys(region: RegionDef): string[] {
  return region.circles.map((c) => `${c.lat},${c.lng}`);
}

function areaKey(a: DiscoveryCampaignArea): string {
  return a.type === "radius" ? `${a.lat},${a.lng}` : a.value;
}

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
                step.n <= current ? "text-[#1F3D2E]" : "bg-slate-100 text-slate-500"
              )}
              style={step.n <= current ? { backgroundColor: "#B2D082" } : undefined}
            >
              {step.n < current ? <CheckCircle2 className="h-4 w-4" /> : step.n}
            </div>
            <span className={cn("text-xs whitespace-nowrap", step.n === current ? "text-slate-900 font-medium" : "text-slate-500")}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("h-0.5 w-12 mx-1 mb-5 transition-all", step.n < current ? "bg-[#B2D082]" : "bg-slate-200")} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Area selector (Step 2) ───────────────────────────────────────────────────

function AreaSelector({
  areas,
  onChange,
}: {
  areas: DiscoveryCampaignArea[];
  onChange: (areas: DiscoveryCampaignArea[]) => void;
}) {
  const [tab, setTab] = useState<"regions" | "custom">("regions");
  const [cityInput, setCityInput] = useState("");
  const [cityRadius, setCityRadius] = useState(30);
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);

  const currentKeys = new Set(areas.map(areaKey));

  function isRegionActive(region: RegionDef) {
    return regionAreaKeys(region).every((k) => currentKeys.has(k));
  }
  function isRegionPartial(region: RegionDef) {
    const keys = regionAreaKeys(region);
    return keys.some((k) => currentKeys.has(k)) && !keys.every((k) => currentKeys.has(k));
  }

  function toggleRegion(region: RegionDef) {
    if (isRegionActive(region)) {
      // Remove all circles of this region
      const keys = new Set(regionAreaKeys(region));
      onChange(areas.filter((a) => !keys.has(areaKey(a))));
    } else {
      // Add missing circles
      const keys = new Set(regionAreaKeys(region));
      const existing = areas.filter((a) => keys.has(areaKey(a)));
      const existingKeys = new Set(existing.map(areaKey));
      const toAdd = regionToAreas(region).filter((a) => !existingKeys.has(areaKey(a)));
      onChange([...areas, ...toAdd]);
    }
  }

  function addCustomCity() {
    const name = cityInput.trim();
    if (!name) return;
    const coords = CITY_COORDS[name];
    if (!coords) {
      // Fallback: city-type search
      const a: DiscoveryCampaignArea = { type: "city", value: name };
      if (!currentKeys.has(areaKey(a))) onChange([...areas, a]);
    } else {
      const a: DiscoveryCampaignArea = {
        type: "radius",
        value: `${name} (${cityRadius} km)`,
        lat: coords.lat,
        lng: coords.lng,
        radius_km: cityRadius,
      };
      if (!currentKeys.has(areaKey(a))) onChange([...areas, a]);
    }
    setCityInput("");
    setCitySuggestions([]);
  }

  function handleCityInputChange(val: string) {
    setCityInput(val);
    if (val.length >= 2) {
      const lower = val.toLowerCase();
      setCitySuggestions(CITY_NAMES.filter((c) => c.toLowerCase().includes(lower)).slice(0, 6));
    } else {
      setCitySuggestions([]);
    }
  }

  function removeArea(a: DiscoveryCampaignArea) {
    onChange(areas.filter((x) => areaKey(x) !== areaKey(a)));
  }

  const totalSearches = areas.length;

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {(["regions", "custom"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-medium transition-all",
              tab === t ? "text-[#1F3D2E]" : "text-slate-500 hover:text-slate-900"
            )}
            style={tab === t ? { backgroundColor: "#B2D082" } : undefined}
          >
            {t === "regions" ? "🗺 Regionen" : "📍 Benutzerdefiniert"}
          </button>
        ))}
      </div>

      {/* Regions tab */}
      {tab === "regions" && (
        <div className="grid grid-cols-2 gap-2">
          {REGIONS.map((region) => {
            const active = isRegionActive(region);
            const partial = isRegionPartial(region);
            return (
              <button
                key={region.label}
                type="button"
                onClick={() => toggleRegion(region)}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm border text-left transition-all",
                  active
                    ? "border-[#B2D082] text-[#1F3D2E] font-medium"
                    : partial
                    ? "border-[#B2D082]/40 bg-slate-50 text-slate-700"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                )}
                style={active ? { backgroundColor: "#B2D082" } : undefined}
              >
                <span className="text-base shrink-0 mt-0.5">{region.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate">{region.label}</span>
                    {active && <span className="text-[#1F3D2E] text-xs shrink-0 ml-1">✓</span>}
                  </div>
                  <div className={cn("text-xs mt-0.5 truncate", active ? "text-[#1F3D2E]/70" : "text-slate-500")}>
                    {region.description}
                  </div>
                  <div className={cn("text-xs mt-0.5", active ? "text-[#1F3D2E]/60" : "text-slate-400")}>
                    {region.circles.length} Suchkreise · bis zu 240 Treffer/Kreis
                    {partial && !active && (
                      <span className="text-[#B2D082]/80 ml-1">
                        ({areas.filter((a) => regionAreaKeys(region).includes(areaKey(a))).length} aktiv)
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom tab */}
      {tab === "custom" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Gib eine Stadt ein und wähle den Suchradius. Das System findet alle Betriebe
            im Umkreis — auch in kleinen Orten wie Herzogenaurach.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="Stadtname (z.B. Nürnberg)…"
                value={cityInput}
                onChange={(e) => handleCityInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addCustomCity(); }
                }}
                className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              />
              {citySuggestions.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
                  {citySuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-slate-50 transition-colors"
                      onClick={() => { setCityInput(s); setCitySuggestions([]); }}
                    >
                      {s}
                      {CITY_COORDS[s] && (
                        <span className="text-slate-500 text-xs ml-2">Koordinaten bekannt</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={cityRadius}
              onChange={(e) => setCityRadius(Number(e.target.value))}
              className="bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none"
            >
              {[10, 20, 30, 40, 50].map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
            <Button
              type="button"
              onClick={addCustomCity}
              disabled={!cityInput.trim()}
              className="text-[#1F3D2E] font-semibold shrink-0"
              style={{ backgroundColor: "#B2D082" }}
            >
              <MapPin className="h-4 w-4" />
            </Button>
          </div>
          {cityInput && CITY_COORDS[cityInput] && (
            <p className="text-xs text-[#B2D082]/80">
              ✓ Koordinaten bekannt — Umkreissuche aktiv (deckt auch Kleinstädte ab)
            </p>
          )}
          {cityInput && !CITY_COORDS[cityInput] && cityInput.length > 2 && (
            <p className="text-xs text-yellow-400/70">
              Koordinaten unbekannt — Suche nach Stadtname (keine Umkreisabdeckung)
            </p>
          )}
        </div>
      )}

      {/* Selected areas */}
      {areas.length > 0 && (
        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">
              {totalSearches} Suchkreis{totalSearches !== 1 ? "e" : ""} ausgewählt
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              Alle entfernen
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
            {areas.map((a) => (
              <span
                key={areaKey(a)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-[#1F3D2E]"
                style={{ backgroundColor: "#B2D082" }}
              >
                {a.value}
                <button
                  type="button"
                  onClick={() => removeArea(a)}
                  className="ml-0.5 hover:opacity-70 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewDiscoveryCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [autoApproveThreshold, setAutoApproveThreshold] = useState("");
  const [areas, setAreas] = useState<DiscoveryCampaignArea[]>([]);
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
          auto_approve_threshold: autoApproveThreshold ? Number(autoApproveThreshold) : undefined,
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

  const estimatedResults = areas.length * categories.length * 60;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-[#B2D082]" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Neue Discovery-Kampagne</h1>
          <p className="text-slate-600 text-sm">
            Gebiete &amp; Branchen auswählen — System sucht automatisch per Umkreis
          </p>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* Step 1 */}
      {step === 1 && (
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Kampagne konfigurieren</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-slate-600 mb-1.5 block">Name <span className="text-red-500">*</span></label>
              <Input
                placeholder="z.B. Bayern Q3 2026 – Industrie"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 mb-1.5 block">Beschreibung (optional)</label>
              <Input
                placeholder="Kurze interne Notiz…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 mb-1.5 block">Zusätzlicher Suchbegriff (optional)</label>
              <Input
                placeholder="z.B. Industrie, Gewerbe…"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 mb-1.5 block">Auto-Genehmigungsschwelle (optional)</label>
              <Input
                type="number"
                placeholder="z.B. 70 (Score ≥ 70 → automatisch genehmigt)"
                value={autoApproveThreshold}
                onChange={(e) => setAutoApproveThreshold(e.target.value)}
                min={0} max={100}
                className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Suchgebiete auswählen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500 mb-4">
              Regionen suchen per Umkreis — deckt automatisch Kleinstädte und Gewerbegebiete ab.
            </p>
            <AreaSelector areas={areas} onChange={setAreas} />
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Branchen auswählen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-500">
                Das System sucht jede Branche in jedem Suchkreis.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all = CATEGORY_OPTIONS.map((c) => c.value);
                    setCategories(all);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                >
                  Alle auswählen
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setCategories([])}
                  className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                >
                  Zurücksetzen
                </button>
              </div>
            </div>

            <div className="space-y-5">
              {CATEGORY_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {group.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const groupValues = group.items.map((i) => i.value);
                        const allSelected = groupValues.every((v) => categories.includes(v));
                        if (allSelected) {
                          setCategories((prev) => prev.filter((c) => !groupValues.includes(c)));
                        } else {
                          setCategories((prev) => [...new Set([...prev, ...groupValues])]);
                        }
                      }}
                      className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
                    >
                      {group.items.every((i) => categories.includes(i.value)) ? "Gruppe abwählen" : "Gruppe wählen"}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map((cat) => {
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
                              : "border-slate-200 text-slate-600 hover:border-slate-300 bg-slate-50"
                          )}
                          style={selected ? { backgroundColor: "#B2D082" } : undefined}
                        >
                          <span className="text-xl">{cat.emoji}</span>
                          <span className="text-xs text-center leading-tight">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {categories.length > 0 && (
              <p className="text-xs text-slate-500 mt-4">
                {categories.length} Branche{categories.length !== 1 ? "n" : ""} × {areas.length} Suchkreis{areas.length !== 1 ? "e" : ""} ={" "}
                <span className="text-slate-900 font-medium">bis zu {estimatedResults.toLocaleString("de-DE")} Treffer</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Zusammenfassung &amp; Starten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3 text-sm">
              <Row label="Kampagnenname" value={name} />
              {description && <Row label="Beschreibung" value={description} />}
              <Row label="Suchkreise" value={`${areas.length}`} />
              <Row
                label="Branchen"
                value={categories
                  .map((c) => CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c)
                  .join(", ")}
              />
              {searchKeyword && <Row label="Suchbegriff" value={searchKeyword} />}
              {autoApproveThreshold && <Row label="Auto-Genehmigung" value={`Score ≥ ${autoApproveThreshold}`} />}
              <div className="border-t border-slate-200 pt-3">
                <Row
                  label="Geschätzte Treffer"
                  value={`bis zu ${estimatedResults.toLocaleString("de-DE")} Gebäude`}
                  highlight
                />
              </div>
            </div>
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-900">
              Die Kampagne startet sofort und läuft im Hintergrund. Du kannst den
              Fortschritt auf der Detailseite verfolgen.
            </div>
            {error && (
              <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-xs text-red-300">{error}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 1 ? router.push("/admin/discovery") : setStep(step - 1))}
          className="border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {step === 1 ? "Abbrechen" : "Zurück"}
        </Button>

        {step < 4 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={
              (step === 1 && name.trim().length < 3) ||
              (step === 2 && areas.length === 0) ||
              (step === 3 && categories.length === 0)
            }
            className="text-[#1F3D2E] font-semibold"
            style={{ backgroundColor: "#B2D082" }}
          >
            Weiter <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="text-[#1F3D2E] font-semibold"
            style={{ backgroundColor: "#B2D082" }}
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Wird gestartet…</>
            ) : (
              <><Radar className="h-4 w-4 mr-2" />Kampagne starten</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-slate-500 w-36 shrink-0">{label}</span>
      <span className={highlight ? "text-[#B2D082] font-medium" : "text-slate-900"}>{value}</span>
    </div>
  );
}
