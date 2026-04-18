import type { SearchProvider } from "./types";
import { MockSearchProvider } from "./mock";
import { GooglePlacesProvider } from "./googlePlaces";

export function getSearchProvider(
  mode: "mock" | "live",
  apiKey?: string
): SearchProvider {
  if (mode === "live" && apiKey) {
    return new GooglePlacesProvider(apiKey);
  }
  return new MockSearchProvider();
}

export type { SearchQuery, SearchResult, SearchProvider } from "./types";
