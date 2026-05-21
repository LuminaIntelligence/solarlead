/**
 * SerpAPI Wrapper — Alternative zu Google CSE für LinkedIn-Discovery.
 *
 * SerpAPI scrapt Google im Auftrag des Users (offizieller Sales-Vertrag),
 * liefert die echten Treffer als JSON. Kein Google-Cloud-Setup nötig.
 *
 * ENV:
 *   SERPAPI_KEY — API-Key von serpapi.com
 *
 * Pricing: $50/Mo für 5.000 Suchen + 100 Gratis-Suchen zum Testen.
 */

const SERPAPI_ENDPOINT = "https://serpapi.com/search";

export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface SerpResponse {
  ok: boolean;
  results: SerpResult[];
  error?: string;
  quotaExceeded?: boolean;
}

export function isSerpApiConfigured(): boolean {
  return !!process.env.SERPAPI_KEY;
}

export async function searchSerp(query: string, num = 5): Promise<SerpResponse> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return {
      ok: false,
      results: [],
      error: "SERPAPI_KEY fehlt in .env.local",
    };
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10)));
  url.searchParams.set("hl", "de");
  url.searchParams.set("gl", "de");
  url.searchParams.set("google_domain", "google.de");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const isQuota = /quota|searches|exceeded|exhausted|no.searches/i.test(text);
      return {
        ok: false,
        results: [],
        error: `SerpAPI HTTP ${res.status}: ${text.slice(0, 200)}`,
        quotaExceeded: isQuota,
      };
    }
    const data = await res.json();

    // SerpAPI gibt im Fehlerfall {error: "..."} mit HTTP 200 zurück (!)
    if (data.error) {
      const isQuota = /searches|quota|exceeded|exhausted|run out/i.test(data.error);
      return {
        ok: false,
        results: [],
        error: `SerpAPI: ${data.error}`,
        quotaExceeded: isQuota,
      };
    }

    const organicResults = (data.organic_results ?? []) as Array<{
      title: string;
      link: string;
      snippet?: string;
      displayed_link?: string;
    }>;

    const results: SerpResult[] = organicResults.map((r) => ({
      title: r.title ?? "",
      link: r.link ?? "",
      snippet: r.snippet ?? "",
      displayLink: r.displayed_link ?? new URL(r.link).hostname,
    }));

    return { ok: true, results };
  } catch (e) {
    return {
      ok: false,
      results: [],
      error: e instanceof Error ? e.message : "Unbekannter Fetch-Fehler",
    };
  }
}
