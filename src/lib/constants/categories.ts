/**
 * Single source of truth for all lead discovery categories.
 * Used in: discovery wizard, outreach wizard, lead filters, dashboard search.
 */

export interface CategoryOption {
  value: string;
  label: string;
  emoji: string;
}

export interface CategoryGroup {
  label: string;
  items: CategoryOption[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    label: "Logistik & Handel",
    items: [
      { value: "logistics",       label: "Logistik",              emoji: "🚛" },
      { value: "warehouse",       label: "Lager / Halle",         emoji: "🏭" },
      { value: "cold_storage",    label: "Kühlhaus",              emoji: "❄️" },
      { value: "wholesale",       label: "Großhandel",            emoji: "📦" },
      { value: "supermarket",     label: "Supermarkt",            emoji: "🛒" },
      { value: "shopping_center", label: "Einkaufszentrum",       emoji: "🏬" },
      { value: "hardware_store",  label: "Baumarkt",              emoji: "🔨" },
      { value: "furniture_store", label: "Möbelhaus",             emoji: "🛋️" },
      { value: "car_dealership",  label: "Autohaus",              emoji: "🚗" },
    ],
  },
  {
    label: "Industrie & Produktion",
    items: [
      { value: "manufacturing",   label: "Fertigung",             emoji: "⚙️" },
      { value: "metalworking",    label: "Metallverarbeitung",    emoji: "🔩" },
      { value: "food_production", label: "Lebensmittel",          emoji: "🍔" },
      { value: "wood_processing", label: "Holzverarbeitung",      emoji: "🪵" },
      { value: "plastics",        label: "Kunststofftechnik",     emoji: "🔧" },
      { value: "printing",        label: "Druckerei",             emoji: "🖨️" },
      { value: "brewery",         label: "Brauerei / Getränke",   emoji: "🍺" },
      { value: "recycling",       label: "Recycling / Entsorgung",emoji: "♻️" },
    ],
  },
  {
    label: "Agrar & Gewächshaus",
    items: [
      { value: "farm",            label: "Landwirtschaft",        emoji: "🌾" },
      { value: "greenhouse",      label: "Gewächshaus",           emoji: "🌱" },
    ],
  },
  {
    label: "Öffentlich & Sozial",
    items: [
      { value: "hospital",        label: "Klinik / Krankenhaus",  emoji: "🏥" },
      { value: "swimming_pool",   label: "Hallenbad / Freibad",   emoji: "🏊" },
      { value: "sports_hall",     label: "Sporthalle",            emoji: "🏟️" },
      { value: "school",          label: "Schule / Bildung",      emoji: "🏫" },
      { value: "events_hall",     label: "Veranstaltungshalle",   emoji: "🎪" },
      { value: "church",          label: "Kirche / Gemeinde",     emoji: "⛪" },
    ],
  },
  {
    label: "Dienstleistungen",
    items: [
      { value: "hotel",           label: "Hotel",                 emoji: "🏨" },
      { value: "laundry",         label: "Wäscherei",             emoji: "👕" },
      { value: "data_center",     label: "Rechenzentrum",         emoji: "🖥️" },
      { value: "gas_station",     label: "Tankstelle",            emoji: "⛽" },
      { value: "car_park",        label: "Parkhaus",              emoji: "🅿️" },
    ],
  },
];

/** Flat list of all categories — for dropdowns, lookups, etc. */
export const CATEGORY_OPTIONS: CategoryOption[] = CATEGORY_GROUPS.flatMap((g) => g.items);

/** Quick label lookup: value → label */
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map(({ value, label }) => [value, label])
);

/** Quick emoji lookup: value → emoji */
export const CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map(({ value, emoji }) => [value, emoji])
);

/** Returns human-readable label, falls back to value if unknown */
export function getCategoryLabel(value: string): string {
  return CATEGORY_LABEL[value] ?? value;
}
