import type { EnrichmentProvider, EnrichmentQuery, EnrichmentResult } from "./types";

const TARGET_KEYWORDS = [
  "production",
  "logistics",
  "warehouse",
  "cooling",
  "cold storage",
  "machinery",
  "industrial",
  "manufacturing",
  "metalwork",
  "energy",
  "sustainable",
  "fleet",
  "distribution",
] as const;

/** Simulated website metadata keyed by domain patterns */
const MOCK_WEBSITES: Record<
  string,
  { title: string; description: string; keywords: string[] }
> = {
  logistik: {
    title: "Professionelle Logistiklösungen | Transport & Lagerung",
    description:
      "Ihr Partner für effiziente Logistik, Distribution und Lagerhaltung in ganz Deutschland.",
    keywords: ["logistics", "warehouse", "distribution", "fleet"],
  },
  transport: {
    title: "Zuverlässige Transportlösungen für Industrie und Handel",
    description:
      "Schneller und sicherer Transport mit moderner Flotte. Deutschlandweite Distribution.",
    keywords: ["logistics", "distribution", "fleet"],
  },
  lager: {
    title: "Moderne Lagertechnik & Fulfillment Services",
    description:
      "Hochregallager, Kommissionierung und Fulfillment aus einer Hand.",
    keywords: ["warehouse", "logistics", "distribution"],
  },
  frost: {
    title: "Kühllogistik & Tiefkühllagerung",
    description:
      "Temperaturgeführte Lagerung und Transport für Lebensmittel und Pharma.",
    keywords: ["cold storage", "cooling", "logistics", "warehouse"],
  },
  kuehl: {
    title: "Kühllager & Frischelogistik GmbH",
    description:
      "Professionelle Kühllagerung mit modernster Technik für sensible Waren.",
    keywords: ["cold storage", "cooling", "warehouse", "energy"],
  },
  maschinenbau: {
    title: "Innovative Maschinenbaulösungen",
    description:
      "Entwicklung und Fertigung industrieller Maschinen und Anlagen seit 1985.",
    keywords: ["manufacturing", "machinery", "industrial", "production"],
  },
  metall: {
    title: "Präzisions-Metallbearbeitung & Stahlbau",
    description:
      "CNC-Fertigung, Schweißtechnik und Stahlkonstruktionen für die Industrie.",
    keywords: ["metalwork", "manufacturing", "industrial", "production"],
  },
  stahl: {
    title: "Stahlbau & Schweißtechnik Fachbetrieb",
    description:
      "Professioneller Stahlbau und Metallverarbeitung für Industrie und Gewerbe.",
    keywords: ["metalwork", "industrial", "manufacturing"],
  },
  industrie: {
    title: "Industriewerke - Fertigung & Produktion",
    description:
      "Führender Industriebetrieb für Serienfertigung und Sonderanfertigungen.",
    keywords: ["industrial", "manufacturing", "production", "machinery"],
  },
  autohaus: {
    title: "Ihr Autohaus für Neuwagen & Gebrauchtwagen",
    description:
      "Große Auswahl an Fahrzeugen, Werkstattservice und Finanzierungsangebote.",
    keywords: ["fleet", "sustainable", "energy"],
  },
  mercedes: {
    title: "Mercedes-Benz Niederlassung - Verkauf & Service",
    description:
      "Autorisierter Mercedes-Benz Partner mit Verkauf, Leasing und Werkstattservice.",
    keywords: ["fleet", "sustainable"],
  },
  hotel: {
    title: "Erstklassiges Hotel & Tagungszentrum",
    description:
      "Komfortable Zimmer, Tagungsräume und Gastronomie für Geschäfts- und Privatreisende.",
    keywords: ["energy", "sustainable"],
  },
  moebel: {
    title: "Möbelhaus - Einrichtung & Wohnideen",
    description:
      "Große Ausstellung mit Möbeln, Küchen und Wohnaccessoires auf über 5.000 m².",
    keywords: ["warehouse", "distribution"],
  },
  baumarkt: {
    title: "Baumarkt & Gartencenter - Alles für Heim & Garten",
    description:
      "Werkzeuge, Baustoffe und Gartenartikel. Fachberatung und Lieferservice.",
    keywords: ["warehouse", "industrial", "energy"],
  },
  obi: {
    title: "OBI Bau- und Heimwerkermarkt",
    description:
      "Europas größte Baumarktkette mit über 350 Märkten in Deutschland.",
    keywords: ["warehouse", "energy"],
  },
  edeka: {
    title: "EDEKA - Wir lieben Lebensmittel",
    description:
      "Frische Lebensmittel, regionale Produkte und große Markenauswahl.",
    keywords: ["cold storage", "cooling", "distribution", "production"],
  },
  rewe: {
    title: "REWE Supermarkt - Qualität zum guten Preis",
    description:
      "Große Auswahl an Lebensmitteln, Getränken und Haushaltswaren.",
    keywords: ["cold storage", "cooling", "distribution"],
  },
  backwaren: {
    title: "Traditionelle Backwaren - Bäckerei & Konditorei",
    description:
      "Handwerkliche Backkunst mit regionalen Zutaten seit Generationen.",
    keywords: ["production", "manufacturing", "energy"],
  },
  fisch: {
    title: "Fischverarbeitung & Meeresfrüchte Großhandel",
    description:
      "Frischer Fisch, Tiefkühlware und Feinkost direkt vom Hafen.",
    keywords: ["production", "cold storage", "cooling", "distribution"],
  },
  einkaufszentrum: {
    title: "Einkaufszentrum - Shopping, Gastronomie & Entertainment",
    description:
      "Über 100 Geschäfte, Restaurants und Unterhaltung unter einem Dach.",
    keywords: ["energy", "sustainable"],
  },
  alexa: {
    title: "ALEXA Berlin - Dein Shopping Center am Alexanderplatz",
    description:
      "Über 170 Shops auf 56.000 m² direkt am Alexanderplatz.",
    keywords: ["energy", "sustainable"],
  },
};

function findMockDataForUrl(
  url: string
): { title: string; description: string; keywords: string[] } | null {
  const normalized = url.toLowerCase();
  for (const [pattern, data] of Object.entries(MOCK_WEBSITES)) {
    if (normalized.includes(pattern)) {
      return data;
    }
  }
  return null;
}

export class MockEnrichmentProvider implements EnrichmentProvider {
  name = "mock";

  async enrich(query: EnrichmentQuery): Promise<EnrichmentResult | null> {
    // Simulate async delay
    await new Promise((resolve) => setTimeout(resolve, 80));

    const mockData = findMockDataForUrl(query.website);

    if (!mockData) {
      // Generate generic fallback data
      const domainMatch = query.website.match(
        /(?:https?:\/\/)?(?:www\.)?([^./]+)/
      );
      const domain = domainMatch?.[1] ?? "unknown";

      return {
        website_title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} - Unternehmenswebsite`,
        meta_description: "Informationen zu unserem Unternehmen und unseren Dienstleistungen.",
        detected_keywords: [],
        enrichment_score: 10,
      };
    }

    // Validate detected keywords against the target list
    const validKeywords = mockData.keywords.filter((kw) =>
      TARGET_KEYWORDS.includes(kw as (typeof TARGET_KEYWORDS)[number])
    );

    // Score: base 20 + 6 points per keyword, max 100
    const enrichment_score = Math.min(100, 20 + validKeywords.length * 16);

    return {
      website_title: mockData.title,
      meta_description: mockData.description,
      detected_keywords: validKeywords,
      enrichment_score,
    };
  }
}
