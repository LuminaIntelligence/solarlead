import type { SolarProvider } from "./types";
import { MockSolarProvider } from "./mock";
import { GoogleSolarProvider } from "./googleSolar";

export function getSolarProvider(
  mode: "mock" | "live",
  apiKey?: string
): SolarProvider {
  if (mode === "live" && apiKey) {
    return new GoogleSolarProvider(apiKey);
  }
  return new MockSolarProvider();
}

export type { SolarQuery, SolarResult, SolarProvider } from "./types";
