/**
 * LinkedIn Company Profile Finder
 * Uses Google Custom Search API to find LinkedIn company pages.
 * Fully legal — just a Google search for "site:linkedin.com/company/ FIRMENNAME"
 */

interface LinkedInSearchResult {
  linkedin_url: string | null;
  confidence: "high" | "medium" | "low";
}

// Google Custom Search JSON API
// Requires: API Key + Programmable Search Engine ID (cx)
// Setup: https://programmablesearchengine.google.com/
const GOOGLE_SEARCH_API = "https://www.googleapis.com/customsearch/v1";

export async function findLinkedInProfile(
  companyName: string,
  city?: string,
  apiKey?: string,
  searchEngineId?: string
): Promise<LinkedInSearchResult> {
  if (!apiKey) {
    console.warn("[LinkedInFinder] Kein Google Search API Key konfiguriert");
    return { linkedin_url: null, confidence: "low" };
  }

  // Wenn keine Search Engine ID vorhanden, nutze die einfache Variante
  if (!searchEngineId) {
    return findLinkedInViaDirectSearch(companyName, city);
  }

  try {
    const query = city
      ? `site:linkedin.com/company/ "${companyName}" "${city}"`
      : `site:linkedin.com/company/ "${companyName}"`;

    const params = new URLSearchParams({
      key: apiKey,
      cx: searchEngineId,
      q: query,
      num: "3",
    });

    const response = await fetch(`${GOOGLE_SEARCH_API}?${params.toString()}`);

    if (!response.ok) {
      console.error(
        `[LinkedInFinder] Google Search API Error: ${response.status}`
      );
      return { linkedin_url: null, confidence: "low" };
    }

    const data = await response.json();
    const items = data.items || [];

    for (const item of items) {
      const link: string = item.link || "";
      if (isLinkedInCompanyUrl(link)) {
        const confidence = matchesCompanyName(companyName, item.title || "", item.snippet || "")
          ? "high"
          : "medium";
        return {
          linkedin_url: normalizeLinkedInUrl(link),
          confidence,
        };
      }
    }

    return { linkedin_url: null, confidence: "low" };
  } catch (error) {
    console.error("[LinkedInFinder] Fehler:", error instanceof Error ? error.message : error);
    return { linkedin_url: null, confidence: "low" };
  }
}

/**
 * Fallback: Direkte Google-Suche ohne Custom Search Engine
 * Nutzt die normale Websuche über fetch (kein API Key nötig, aber rate-limited)
 */
async function findLinkedInViaDirectSearch(
  companyName: string,
  city?: string
): Promise<LinkedInSearchResult> {
  try {
    const query = city
      ? `site:linkedin.com/company "${companyName}" "${city}"`
      : `site:linkedin.com/company "${companyName}"`;

    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "de-DE,de;q=0.9",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { linkedin_url: null, confidence: "low" };
    }

    const html = await response.text();

    // Extrahiere LinkedIn-URLs aus den Suchergebnissen
    const linkedInMatches = html.match(
      /https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-._~]+/g
    );

    if (linkedInMatches && linkedInMatches.length > 0) {
      // Nehme die erste, die wie ein echtes Firmenprofil aussieht
      for (const match of linkedInMatches) {
        if (isLinkedInCompanyUrl(match)) {
          return {
            linkedin_url: normalizeLinkedInUrl(match),
            confidence: "medium",
          };
        }
      }
    }

    return { linkedin_url: null, confidence: "low" };
  } catch {
    return { linkedin_url: null, confidence: "low" };
  }
}

function isLinkedInCompanyUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-._~]+\/?$/i.test(
    url.split("?")[0]
  );
}

function normalizeLinkedInUrl(url: string): string {
  // Entferne Query-Parameter und stelle HTTPS sicher
  let clean = url.split("?")[0].split("#")[0];
  if (clean.startsWith("http://")) {
    clean = clean.replace("http://", "https://");
  }
  if (!clean.startsWith("https://")) {
    clean = "https://" + clean;
  }
  // Stelle sicher, dass www. vorhanden ist
  if (!clean.includes("www.")) {
    clean = clean.replace("linkedin.com", "www.linkedin.com");
  }
  // Trailing slash entfernen
  return clean.replace(/\/$/, "");
}

function matchesCompanyName(
  searchName: string,
  resultTitle: string,
  resultSnippet: string
): boolean {
  const searchLower = searchName.toLowerCase();
  const titleLower = resultTitle.toLowerCase();
  const snippetLower = resultSnippet.toLowerCase();

  // Exakte oder teilweise Übereinstimmung im Titel
  if (titleLower.includes(searchLower)) return true;

  // Prüfe einzelne Wörter (mindestens 2 müssen matchen)
  const searchWords = searchLower.split(/\s+/).filter((w) => w.length > 2);
  const combined = titleLower + " " + snippetLower;
  const matchCount = searchWords.filter((w) => combined.includes(w)).length;

  return matchCount >= Math.min(2, searchWords.length);
}
