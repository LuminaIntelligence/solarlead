import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/actions/settings";

// Mock-Daten für den Testmodus
const MOCK_SUGGESTIONS = [
  {
    place_id: "mock_place_muenchen",
    description: "Industriestraße 1, 80339 München, Deutschland",
  },
  {
    place_id: "mock_place_nuernberg",
    description: "Gewerbepark Nord 5, 90411 Nürnberg, Deutschland",
  },
  {
    place_id: "mock_place_hamburg",
    description: "Logistikallee 12, 20537 Hamburg, Deutschland",
  },
  {
    place_id: "mock_place_berlin",
    description: "Berliner Gewerbestraße 99, 13407 Berlin, Deutschland",
  },
  {
    place_id: "mock_place_frankfurt",
    description: "Mainzer Landstraße 200, 60327 Frankfurt am Main, Deutschland",
  },
];

const MOCK_GEOCODE: Record<
  string,
  {
    formatted_address: string;
    latitude: number;
    longitude: number;
    city: string;
    postal_code: string;
    country: string;
  }
> = {
  mock_place_muenchen: {
    formatted_address: "Industriestraße 1, 80339 München, Deutschland",
    latitude: 48.1351,
    longitude: 11.582,
    city: "München",
    postal_code: "80339",
    country: "DE",
  },
  mock_place_nuernberg: {
    formatted_address: "Gewerbepark Nord 5, 90411 Nürnberg, Deutschland",
    latitude: 49.4521,
    longitude: 11.0767,
    city: "Nürnberg",
    postal_code: "90411",
    country: "DE",
  },
  mock_place_hamburg: {
    formatted_address: "Logistikallee 12, 20537 Hamburg, Deutschland",
    latitude: 53.5753,
    longitude: 10.0153,
    city: "Hamburg",
    postal_code: "20537",
    country: "DE",
  },
  mock_place_berlin: {
    formatted_address: "Berliner Gewerbestraße 99, 13407 Berlin, Deutschland",
    latitude: 52.5244,
    longitude: 13.4105,
    city: "Berlin",
    postal_code: "13407",
    country: "DE",
  },
  mock_place_frankfurt: {
    formatted_address:
      "Mainzer Landstraße 200, 60327 Frankfurt am Main, Deutschland",
    latitude: 50.1109,
    longitude: 8.6821,
    city: "Frankfurt am Main",
    postal_code: "60327",
    country: "DE",
  },
};

/**
 * GET /api/geocode?q=<Eingabe>
 * Gibt Autocomplete-Vorschläge zurück (max. 5)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q") ?? "";
    if (q.trim().length < 3) {
      return NextResponse.json([]);
    }

    const settings = await getUserSettings();
    const mode = settings?.provider_mode ?? "mock";

    if (mode === "mock") {
      const lower = q.toLowerCase();
      const filtered = MOCK_SUGGESTIONS.filter((s) =>
        s.description.toLowerCase().includes(lower)
      );
      return NextResponse.json(
        filtered.length > 0 ? filtered.slice(0, 5) : MOCK_SUGGESTIONS.slice(0, 3)
      );
    }

    // Live: Google Places Autocomplete
    const apiKey =
      settings?.google_places_api_key ?? process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Kein API-Schlüssel konfiguriert" },
        { status: 500 }
      );
    }

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    );
    url.searchParams.set("input", q);
    url.searchParams.set("language", "de");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[geocode] Autocomplete error:", data.status, data.error_message);
      return NextResponse.json(
        { error: data.error_message ?? data.status },
        { status: 502 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suggestions = (data.predictions ?? []).slice(0, 5).map((p: any) => ({
      place_id: p.place_id,
      description: p.description,
    }));

    return NextResponse.json(suggestions);
  } catch (error) {
    console.error("[geocode] GET error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/geocode  { place_id: string }
 * Gibt vollständige Koordinaten + Adressdaten zurück
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const place_id: string = body?.place_id ?? "";
    if (!place_id) {
      return NextResponse.json(
        { error: "place_id erforderlich" },
        { status: 400 }
      );
    }

    const settings = await getUserSettings();
    const mode = settings?.provider_mode ?? "mock";

    if (mode === "mock") {
      const mock =
        MOCK_GEOCODE[place_id] ?? MOCK_GEOCODE["mock_place_muenchen"];
      return NextResponse.json({ ...mock, place_id });
    }

    // Live: Google Place Details
    const apiKey =
      settings?.google_places_api_key ?? process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Kein API-Schlüssel konfiguriert" },
        { status: 500 }
      );
    }

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/details/json"
    );
    url.searchParams.set("place_id", place_id);
    url.searchParams.set(
      "fields",
      "formatted_address,geometry,address_components"
    );
    url.searchParams.set("language", "de");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();

    if (data.status !== "OK") {
      console.error("[geocode] Place Details error:", data.status, data.error_message);
      return NextResponse.json(
        { error: data.error_message ?? data.status },
        { status: 502 }
      );
    }

    const result = data.result;
    const lat: number = result.geometry.location.lat;
    const lng: number = result.geometry.location.lng;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components: any[] = result.address_components ?? [];

    let city = "";
    let postal_code = "";
    let country = "DE";

    for (const comp of components) {
      if (comp.types.includes("locality")) city = comp.long_name;
      if (comp.types.includes("postal_code")) postal_code = comp.long_name;
      if (comp.types.includes("country")) country = comp.short_name;
    }

    return NextResponse.json({
      place_id,
      formatted_address: result.formatted_address as string,
      latitude: lat,
      longitude: lng,
      city,
      postal_code,
      country,
    });
  } catch (error) {
    console.error("[geocode] POST error:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler" },
      { status: 500 }
    );
  }
}
