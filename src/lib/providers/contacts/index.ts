import { ApolloContactProvider } from "./apollo";
import { MockContactProvider } from "./mock";
import type { ContactProvider } from "./types";

export function getContactProvider(
  mode: "mock" | "live",
  apiKey?: string
): ContactProvider {
  if (mode === "live") {
    const key = apiKey ?? process.env.APOLLO_API_KEY;
    if (!key) {
      console.warn("[ContactProvider] Kein Apollo API-Key — falle auf Mock zurück");
      return new MockContactProvider();
    }
    return new ApolloContactProvider(key);
  }
  return new MockContactProvider();
}

export type { ContactProvider, ContactQuery, ContactResult, Contact, CompanyEnrichment } from "./types";
