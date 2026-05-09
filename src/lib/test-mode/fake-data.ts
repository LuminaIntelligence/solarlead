/**
 * Deutsche Fake-Daten für Test-Modus.
 * Keine externen Dependencies — handgepflegte Listen, glaubwürdig genug
 * für E2E-Tests ohne dass es nach AI-Slop aussieht.
 */

const COMPANY_BASES = [
  "Müller Logistik", "Bayerische Kühlhaus", "Hansen Industrie", "Becker Großhandel",
  "Werner Baustoffe", "Schmidt Tiefkühl", "Weber Speditions", "Hoffmann Anlagenbau",
  "Schulz Frischdienst", "Krüger Lebensmittel", "Klein Industrieservice", "Wolff Kühltransport",
  "Lehmann Pharma-Logistik", "Neumann Handelszentrum", "Braun Bau", "Zimmermann Lager",
  "Fischer Distribution", "Hartmann Großmarkt", "Vogel Kühlanlagen", "Lange Bauelemente",
  "Stein Logistik", "Berger Spedition", "Frank Industrieholding", "König Tiefbau",
  "Friedrich Lager", "Albrecht Kühlhaus", "Engel Großhandel", "Roth Tiefkühlcenter",
  "Walter Logistik", "Peters Lebensmittelhandel",
];
const COMPANY_SUFFIXES = ["GmbH", "GmbH & Co. KG", "AG", "e.V.", "Holding GmbH", "AG & Co. KG"];

const FIRST_NAMES = [
  "Andreas", "Bernd", "Christian", "Daniel", "Elke", "Frank", "Gerhard", "Heike",
  "Ingrid", "Jürgen", "Klaus", "Lisa", "Martin", "Nicole", "Otto", "Petra",
  "Rainer", "Sabine", "Thomas", "Ursula", "Volker", "Werner", "Yvonne", "Zacharias",
  "Anna", "Birgit", "Carsten", "Diana", "Erik", "Franziska",
];
const LAST_NAMES = [
  "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
  "Schulz", "Hoffmann", "Schäfer", "Koch", "Bauer", "Richter", "Klein", "Wolf",
  "Schröder", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger", "Hofmann", "Hartmann",
  "Lange", "Schmitt", "Werner", "Schmitz", "Krause", "Meier",
];
const TITLES = [
  "Geschäftsführer", "Geschäftsführerin", "Inhaber", "Inhaberin", "Prokurist",
  "Standortleiter", "Operations-Leiter", "Facility Manager", "Leiter Energie",
  "Vorstand", "CFO", "COO",
];

const CITIES: Array<{ name: string; lat: number; lng: number }> = [
  { name: "München",   lat: 48.1351, lng: 11.5820 },
  { name: "Augsburg",  lat: 48.3705, lng: 10.8978 },
  { name: "Nürnberg",  lat: 49.4521, lng: 11.0767 },
  { name: "Regensburg",lat: 49.0134, lng: 12.1016 },
  { name: "Würzburg",  lat: 49.7913, lng: 9.9534 },
  { name: "Ingolstadt",lat: 48.7665, lng: 11.4258 },
  { name: "Erlangen",  lat: 49.5896, lng: 11.0119 },
  { name: "Fürth",     lat: 49.4773, lng: 10.9888 },
  { name: "Bayreuth",  lat: 49.9456, lng: 11.5713 },
  { name: "Landshut",  lat: 48.5448, lng: 12.1511 },
];
const STREETS = [
  "Industriestraße", "Hauptstraße", "Bahnhofstraße", "Gewerbestraße", "Ringstraße",
  "Logistikweg", "Am Industriepark", "Schulstraße", "Kirchplatz", "Marktstraße",
];

const CATEGORIES = [
  "cold_storage", "logistics", "food_distribution", "construction_supply", "industrial",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export interface FakeLead {
  index: number;
  emailHandle: string; // alpha1, alpha2, ...
  contactEmail: string;
  contactName: string;
  contactTitle: string;
  companyName: string;
  companyCity: string;
  companyCategory: string;
  address: string;
  lat: number;
  lng: number;
  roofAreaM2: number;
  maxArrayPanelsCount: number;
  annualEnergyKwh: number;
}

export function generateTestLead(index: number): FakeLead {
  const city = pick(CITIES);
  // Slight jitter on coords so leads aren't all on the exact same pin
  const latJitter = (Math.random() - 0.5) * 0.05;
  const lngJitter = (Math.random() - 0.5) * 0.05;
  const lat = city.lat + latJitter;
  const lng = city.lng + lngJitter;

  const firstName = pick(FIRST_NAMES);
  const lastName  = pick(LAST_NAMES);
  const company   = `[TEST] ${pick(COMPANY_BASES)} ${pick(COMPANY_SUFFIXES)}`;
  const street    = pick(STREETS);
  const houseNum  = pickInt(1, 199);
  const plz       = pickInt(80000, 96499); // bayerische PLZ-Range, plausibel

  // Realistische Dachflächen-Range: kleines Lager ~200 m², Großbetrieb bis 5000 m²
  const roofAreaM2 = pickInt(250, 4500);
  // ~6-8 m² pro 1 kWp
  const maxArrayPanelsCount = Math.round(roofAreaM2 / 1.7); // ca. 1.7 m² pro Panel
  const annualEnergyKwh = Math.round(roofAreaM2 * 0.18 * 1000); // grobe Schätzung

  return {
    index,
    emailHandle: `alpha${index}`,
    contactEmail: `alpha${index}@lumina-intelligence.ai`,
    contactName: `${firstName} ${lastName}`,
    contactTitle: pick(TITLES),
    companyName: company,
    companyCity: city.name,
    companyCategory: pick(CATEGORIES),
    address: `${street} ${houseNum}, ${plz} ${city.name}`,
    lat,
    lng,
    roofAreaM2,
    maxArrayPanelsCount,
    annualEnergyKwh,
  };
}

export function generateTestLeads(count = 30): FakeLead[] {
  return Array.from({ length: count }, (_, i) => generateTestLead(i + 1));
}
