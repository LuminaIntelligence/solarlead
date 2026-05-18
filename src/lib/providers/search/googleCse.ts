/**
 * Google Custom Search API Wrapper
 *
 * Genutzt für LinkedIn-URL-Discovery — siehe lib/linkedin/finder.ts.
 *
 * ENV-Variablen:
 *   GOOGLE_CSE_API_KEY  — API-Key mit aktivierter Custom Search API
 *                         (Fallback: GOOGLE_PLACES_API_KEY)
 *   GOOGLE_CSE_ID       — Search Engine ID aus programmablesearchengine.google.com
 *                         (im Engine-Setup "Search the entire web" aktivieren)
 *
 * Pricing: 100 Suchen/Tag gratis, danach $5 / 1000 Suchen.
 * Tageslimit über daily_api_usage (provider='google_cse') gesteuert.
 */

const CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export interface CseResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface CseResponse {
  ok: boolean;
  results: CseResult[];
  error?: string;
  quotaExceeded?: boolean;
}

export function isCseConfigured(): boolean {
  const key = process.env.GOOGLE_CSE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;
  return !!(key && process.env.GOOGLE_CSE_ID);
}

export async function searchCse(query: string, num = 5): Promise<CseResponse> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cx) {
    return {
      ok: false,
      results: [],
      error: "GOOGLE_CSE_API_KEY oder GOOGLE_CSE_ID fehlt in .env.local",
    };
  }

  const url = new URL(CSE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10)));
  url.searchParams.set("safe", "off");
  // hl=de für deutsche Snippets (bessere Title/Role-Erkennung)
  url.searchParams.set("hl", "de");
  url.searchParams.set("gl", "de");

  try {
    const res = await fetch(url.toString());
    if (res.status === 429 || res.status === 403) {
      const text = await res.text().catch(() => "");
      const isQuota = /quota|rate|limit/i.test(text);
      return {
        ok: false,
        results: [],
        error: `Quota erschöpft oder Auth-Fehler (${res.status}): ${text.slice(0, 200)}`,
        quotaExceeded: isQuota,
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        results: [],
        error: `CSE HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const items = (data.items ?? []) as Array<{
      title: string;
      link: string;
      snippet: string;
      displayLink: string;
    }>;
    return { ok: true, results: items };
  } catch (e) {
    return {
      ok: false,
      results: [],
      error: e instanceof Error ? e.message : "Unbekannter Fetch-Fehler",
    };
  }
}
