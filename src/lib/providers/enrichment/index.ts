import type { EnrichmentProvider } from "./types";
import { MockEnrichmentProvider } from "./mock";
import { WebsiteEnrichmentProvider } from "./website";

export function getEnrichmentProvider(
  mode: "mock" | "live"
): EnrichmentProvider {
  if (mode === "live") {
    return new WebsiteEnrichmentProvider();
  }
  return new MockEnrichmentProvider();
}

export type { EnrichmentQuery, EnrichmentResult, EnrichmentProvider } from "./types";
