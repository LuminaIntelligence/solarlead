"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export interface SystemApiKeys {
  mode: "live" | "mock";
  googleSolarApiKey: string | undefined;
  googlePlacesApiKey: string | undefined;
}

/**
 * Returns the system-wide API configuration (solar + places keys) from the
 * first user_settings row that has provider_mode = "live".
 *
 * Use this in all routes that need Google Solar or Google Places API keys,
 * instead of getUserSettings() which reads the individual caller's row —
 * new users have provider_mode = "mock" by default, so they'd always get
 * mock data even when the system has live keys configured.
 *
 * Contacts / enrichment providers (Apollo, Hunter, Firecrawl) use env vars
 * directly and do not need this function.
 */
export async function getSystemApiKeys(): Promise<SystemApiKeys> {
  try {
    const adminClient = createAdminClient();
    const { data } = await adminClient
      .from("user_settings")
      .select("google_solar_api_key, google_places_api_key")
      .eq("provider_mode", "live")
      .limit(1)
      .maybeSingle();

    if (!data) {
      return { mode: "mock", googleSolarApiKey: undefined, googlePlacesApiKey: undefined };
    }

    return {
      mode: "live",
      googleSolarApiKey: data.google_solar_api_key ?? undefined,
      googlePlacesApiKey: data.google_places_api_key ?? undefined,
    };
  } catch {
    return { mode: "mock", googleSolarApiKey: undefined, googlePlacesApiKey: undefined };
  }
}
