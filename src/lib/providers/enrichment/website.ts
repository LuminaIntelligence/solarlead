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

/**
 * SSRF-Schutz: Blockt interne IP-Ranges und Cloud-Metadata-Endpoints
 */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Localhost + loopback
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127.")) return true;

  // Private IP-Ranges (RFC 1918)
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;

  // Link-local / Cloud metadata
  if (/^169\.254\./.test(h)) return true; // AWS/GCP/Azure metadata
  if (h === "metadata.google.internal") return true;

  // IPv6 private
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;

  // Docker/internal network
  if (/^172\.17\./.test(h)) return true;

  return false;
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

    // SSRF-Schutz: interne Netze blockieren
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        console.warn(`[WebsiteEnrichmentProvider] Invalid protocol: ${parsed.protocol}`);
        return null;
      }
      if (isBlockedHost(parsed.hostname)) {
        console.warn(`[WebsiteEnrichmentProvider] Blocked internal host: ${parsed.hostname}`);
        return null;
      }
    } catch {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; SolarLeadBot/1.0; +https://solarlead.ai)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

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

      const html = await response.text();

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
