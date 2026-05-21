/**
 * Such-Provider-Abstraktion.
 *
 * Wählt automatisch den besten verfügbaren Provider:
 *   1. SerpAPI wenn SERPAPI_KEY gesetzt (zuverlässig, keine Google-Cloud-Politik)
 *   2. Google CSE als Fallback wenn nur GOOGLE_CSE_* gesetzt
 *
 * Beide Provider liefern dasselbe Result-Format (CseResult /
 * SerpResult sind identisch strukturiert).
 */

import { searchCse, isCseConfigured, type CseResponse } from "./googleCse";
import { searchSerp, isSerpApiConfigured, type SerpResponse } from "./serpApi";

export type SearchProvider = "serpapi" | "google_cse" | null;

export interface SearchResponse {
  ok: boolean;
  results: Array<{
    title: string;
    link: string;
    snippet: string;
    displayLink: string;
  }>;
  error?: string;
  quotaExceeded?: boolean;
  provider: SearchProvider;
}

export function activeProvider(): SearchProvider {
  if (isSerpApiConfigured()) return "serpapi";
  if (isCseConfigured()) return "google_cse";
  return null;
}

export function isAnySearchProviderConfigured(): boolean {
  return activeProvider() !== null;
}

export async function searchWeb(query: string, num = 5): Promise<SearchResponse> {
  const provider = activeProvider();

  if (provider === "serpapi") {
    const r = await searchSerp(query, num);
    return {
      ok: r.ok,
      results: r.results,
      error: r.error,
      quotaExceeded: r.quotaExceeded,
      provider: "serpapi",
    };
  }

  if (provider === "google_cse") {
    const r: CseResponse = await searchCse(query, num);
    return {
      ok: r.ok,
      results: r.results,
      error: r.error,
      quotaExceeded: r.quotaExceeded,
      provider: "google_cse",
    };
  }

  return {
    ok: false,
    results: [],
    error: "Kein Such-Provider konfiguriert (SERPAPI_KEY oder GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID setzen)",
    provider: null,
  };
}
