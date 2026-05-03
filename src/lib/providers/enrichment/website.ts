import type { EnrichmentProvider, EnrichmentQuery, EnrichmentResult } from "./types";
import { safeFetch } from "@/lib/security/url-guard";

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

/** German equivalents of target keywords for broader detection */
const KEYWORD_ALIASES: Record<string, string> = {
  produktion: "production",
  fertigung: "production",
  herstellung: "manufacturing",
  logistik: "logistics",
  spedition: "logistics",
  lager: "warehouse",
  lagerhaltung: "warehouse",
  kühlung: "cooling",
  kühllager: "cold storage",
  tiefkühl: "cold storage",
  maschinen: "machinery",
  maschinenbau: "machinery",
  industrie: "industrial",
  industriell: "industrial",
  metall: "metalwork",
  metallbau: "metalwork",
  schweißen: "metalwork",
  energie: "energy",
  solar: "energy",
  nachhaltig: "sustainable",
  nachhaltigkeit: "sustainable",
  fuhrpark: "fleet",
  flotte: "fleet",
  vertrieb: "distribution",
  distribution: "distribution",
  verteilung: "distribution",
};

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : null;
}

function extractMetaDescription(html: string): string | null {
  const metaMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i
  );
  if (metaMatch) return metaMatch[1].trim();

  // Try reversed attribute order
  const reversedMatch = html.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*\/?>/i
  );
  return reversedMatch ? reversedMatch[1].trim() : null;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectKeywords(text: string): string[] {
  const lowerText = text.toLowerCase();
  const detected = new Set<string>();

  // Check direct English keywords
  for (const keyword of TARGET_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      detected.add(keyword);
    }
  }

  // Check German aliases
  for (const [alias, keyword] of Object.entries(KEYWORD_ALIASES)) {
    if (lowerText.includes(alias)) {
      detected.add(keyword);
    }
  }

  return Array.from(detected);
}

function calculateScore(keywords: string[]): number {
  if (keywords.length === 0) return 5;
  // Base 15 + 13 per keyword, capped at 100
  return Math.min(100, 15 + keywords.length * 13);
}

export class WebsiteEnrichmentProvider implements EnrichmentProvider {
  name = "website";

  async enrich(query: EnrichmentQuery): Promise<EnrichmentResult | null> {
    const url = normalizeUrl(query.website);

    // SSRF-safe fetch: rejects internal/loopback hosts via DNS resolution,
    // streams body with hard size cap, applies timeout.
    const response = await safeFetch(url, {
      timeoutMs: 5000,
      maxBytes: 2_000_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SolarLeadBot/1.0; +https://solarlead.ai)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
    });

    if (!response) return null;

    try {
      if (!response.ok) {
        console.error(
          `[WebsiteEnrichmentProvider] HTTP ${response.status} for ${url}`
        );
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        console.warn(
          `[WebsiteEnrichmentProvider] Non-HTML content type for ${url}: ${contentType}`
        );
        return null;
      }

      const html = response.text;

      const title = extractTitle(html);
      const metaDescription = extractMetaDescription(html);
      const plainText = stripHtmlTags(html);

      // Combine all text sources for keyword detection
      const combinedText = [title, metaDescription, plainText]
        .filter(Boolean)
        .join(" ");

      const detectedKeywords = detectKeywords(combinedText);
      const enrichmentScore = calculateScore(detectedKeywords);

      return {
        website_title: title,
        meta_description: metaDescription,
        detected_keywords: detectedKeywords,
        enrichment_score: enrichmentScore,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.error(
          `[WebsiteEnrichmentProvider] Request timed out for ${url}`
        );
      } else {
        console.error(
          `[WebsiteEnrichmentProvider] Failed to enrich ${url}:`,
          error instanceof Error ? error.message : error
        );
      }
      return null;
    }
  }
}
